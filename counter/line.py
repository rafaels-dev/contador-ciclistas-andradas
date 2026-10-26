"""
Vertical counting-line crossing counter.

Philosophy (v2): ONLY objects that actually cross the line x = line_x count.
Four counting paths, mutually exclusive per ID:

  1. "centroid"      — the track persists and its cx switches sides of the
                       line.
  2. "centroid_gap"  — the track disappears for a few frames and the SAME ID
                       comes back on the other side (ByteTrack re-associated
                       it within track_buffer). The crossing happened during
                       the gap.
  3. "reid_opposite" — the track breaks during the crossing and a NEW ID
                       shows up on the opposite side of an ID lost
                       ≤ reid_window frames ago, with vertical coherence
                       (same lane). Counts once, inheriting the lost ID's
                       history.
  4. "entry"         — legacy, off by default (count_on_entry). Counts on
                       entering through the frame edge; the direction comes
                       from the entry edge (right edge → moving left = in),
                       not from the current side.

Same-side re-ID (same_side_window, spatial_dist): a new ID on the SAME side
of a recently lost ID and spatially close → partial occlusion / brief
re-detection. Merged without counting; inherits the "already counted" status.

Idempotency
-----------
  Every counted ID goes into `_counted`; no path counts the same ID twice
  (all paths check it). IDs lost for more than `cleanup_window` frames are
  removed from `_lost` and `_counted` (supervision's ByteTrack does not reuse
  IDs, so this only bounds memory on continuous runs).
"""

from __future__ import annotations

import numpy as np
import supervision as sv


class CountingLine:
    """
    Parameters
    ----------
    line_x : int
        Horizontal position of the line (pixels).
    frame_width : int
        Frame width in pixels (for the edge check of the legacy "entry"
        mode). 0 disables the edge check.
    edge_margin : int
        Max distance to the edge (pixels) to consider an object "entering".
    reid_window : int
        Window (frames) for opposite-side re-ID (tracks broken mid-crossing).
    same_side_window : int
        Window (frames) for same-side re-ID (partial occlusion).
    spatial_dist : float
        Max cx distance (pixels) for same-side re-ID.
    vertical_dist : float
        Max cy distance (pixels) for any re-ID (lane coherence).
    reid_max_speed : float
        Max plausible horizontal speed (px/frame) for the opposite-side
        re-ID: the implied |cx_new - cx_lost| must fit within
        reid_max_speed × gap frames.
    count_on_entry : bool
        Legacy mode: counts objects as they enter through the frame edge,
        even without crossing the line. Off by default.
    """

    def __init__(
        self,
        line_x: int,
        frame_width: int = 0,
        edge_margin: int = 80,
        reid_window: int = 20,
        same_side_window: int = 30,
        spatial_dist: float = 120.0,
        vertical_dist: float = 180.0,
        reid_max_speed: float = 100.0,
        count_on_entry: bool = False,
    ):
        self.line_x           = line_x
        self.frame_width      = frame_width
        self.edge_margin      = edge_margin
        self.reid_window      = reid_window
        self.same_side_window = same_side_window
        self.spatial_dist     = spatial_dist
        self.vertical_dist    = vertical_dist
        self.reid_max_speed   = reid_max_speed
        self.count_on_entry   = count_on_entry

        self.in_count  = 0   # right → left
        self.out_count = 0   # left → right

        # id → (side, cx, cy, dx)  — dx = horizontal speed (px/frame, EMA)
        self._active: dict[int, tuple[str, float, float, float]] = {}

        # id → (last side, frame it vanished, last cx, last cy, dx)
        self._lost: dict[int, tuple[str, int, float, float, float]] = {}

        # IDs already counted — prevents double counting through any path
        self._counted: set[int] = set()

        self._frame: int = 0

        # Count event log (diagnostics): dicts with frame, tid, side, reason
        self.events: list[dict] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def trigger(
        self, detections: sv.Detections
    ) -> tuple[np.ndarray, np.ndarray]:
        """Processes one frame. Returns (crossed_in, crossed_out) bool arrays."""
        self._frame += 1
        n = len(detections)
        crossed_in  = np.zeros(n, dtype=bool)
        crossed_out = np.zeros(n, dtype=bool)
        active_ids: set[int] = set()

        if n > 0 and detections.tracker_id is not None:
            active_ids = set(detections.tracker_id.tolist())

            for j, tid in enumerate(detections.tracker_id):
                x1 = float(detections.xyxy[j, 0])
                x2 = float(detections.xyxy[j, 2])
                cx = (x1 + x2) / 2
                cy = float(detections.xyxy[j, 1] + detections.xyxy[j, 3]) / 2
                side = "left" if cx < self.line_x else "right"

                dx = 0.0
                if tid in self._active:
                    # ── Continuous track: centroid crossing ──────────────
                    prev_side, prev_cx, _, prev_dx = self._active[tid]
                    dx = 0.5 * prev_dx + 0.5 * (cx - prev_cx)
                    if side != prev_side and tid not in self._counted:
                        self._count(tid, side, j, crossed_in, crossed_out,
                                    reason="centroid", dx=dx)

                elif tid in self._lost:
                    # ── SAME ID resumed after a gap ──────────────────────
                    prev_side, _, _, _, prev_dx = self._lost.pop(tid)
                    dx = prev_dx
                    if side != prev_side and tid not in self._counted:
                        # crossed the line during the gap
                        self._count(tid, side, j, crossed_in, crossed_out,
                                    reason="centroid_gap", dx=dx)

                else:
                    # ── New ID ───────────────────────────────────────────

                    # 0. Duplicate box: new ID glued to an ACTIVE track that
                    #    was already counted (double detection of the same
                    #    object) → inherits "counted", never counts.
                    if self._near_counted_active(tid, cx, cy):
                        self._counted.add(tid)
                        self._active[tid] = (side, cx, cy, dx)
                        continue

                    # 1. Same-side re-ID (partial occlusion, brief re-detection)
                    same_pair = self._same_side_pair(side, cx, cy)
                    if same_pair is not None:
                        self._merge(tid, same_pair)

                    else:
                        # 2. Opposite-side re-ID (track broken mid-crossing)
                        opposite_pair = self._opposite_side_pair(side, cx, cy)
                        if opposite_pair is not None:
                            already = (tid in self._counted
                                       or opposite_pair in self._counted)
                            del self._lost[opposite_pair]
                            self._counted.discard(opposite_pair)
                            if not already:
                                self._count(tid, side, j, crossed_in, crossed_out,
                                            reason="reid_opposite")
                            else:
                                self._counted.add(tid)

                        # 3. Legacy mode: counts on entering through the edge
                        elif (self.count_on_entry
                              and tid not in self._counted
                              and self._at_edge(x1, x2)):
                            # direction inferred from the entry edge:
                            # right edge → moving left (in)
                            right_edge = x2 >= self.frame_width - self.edge_margin
                            target_side = "left" if right_edge else "right"
                            self._count(tid, target_side, j,
                                        crossed_in, crossed_out, reason="entry")

                        # 4. Otherwise: wait for a centroid crossing

                self._active[tid] = (side, cx, cy, dx)

        self._update_lost(active_ids)
        return crossed_in, crossed_out

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _at_edge(self, x1: float, x2: float) -> bool:
        """True if the bbox touches the left or right frame edge."""
        if self.frame_width == 0:
            return False
        return x1 <= self.edge_margin or x2 >= self.frame_width - self.edge_margin

    def _count(
        self,
        tid: int,
        side: str,
        j: int,
        crossed_in: np.ndarray,
        crossed_out: np.ndarray,
        reason: str = "?",
        dx: float = 0.0,
    ) -> None:
        self._counted.add(tid)
        if side == "left":       # right → left
            self.in_count += 1
            crossed_in[j] = True
        else:                    # left → right
            self.out_count += 1
            crossed_out[j] = True
        self.events.append(
            {"frame": self._frame, "tid": int(tid), "side": side,
             "reason": reason, "dx": round(float(dx), 1)}
        )

    def _merge(self, new_tid: int, pair: int) -> None:
        """Merges a new ID with a lost ID without counting; inherits "counted"."""
        if pair in self._counted:
            self._counted.add(new_tid)
        del self._lost[pair]
        self._counted.discard(pair)

    def _near_counted_active(self, tid: int, cx: float, cy: float) -> bool:
        """True if (cx, cy) is glued to an active, already-counted track."""
        for tid_a, (_side, acx, acy, _adx) in self._active.items():
            if tid_a == tid or tid_a not in self._counted:
                continue
            if abs(cx - acx) <= 80 and abs(cy - acy) <= 120:
                return True
        return False

    def _same_side_pair(self, side: str, cx: float, cy: float) -> int | None:
        """Re-ID: lost on the SAME side, close in cx and cy."""
        best_tid  = None
        best_dist = float("inf")
        for tid, (last_side, last_frame, last_cx, last_cy, _dx) in self._lost.items():
            if last_side != side:
                continue
            if self._frame - last_frame > self.same_side_window:
                continue
            if abs(cy - last_cy) > self.vertical_dist:
                continue
            dist = abs(cx - last_cx)
            if dist <= self.spatial_dist and dist < best_dist:
                best_dist = dist
                best_tid  = tid
        return best_tid

    def _opposite_side_pair(self, side: str, cx: float, cy: float) -> int | None:
        """Re-ID: lost on the OPPOSITE side (track broken mid-crossing).

        Requires the "invisible crossing" to be physically plausible:
          - vertical coherence (same traffic lane);
          - the implied displacement fits in reid_max_speed px per gap frame;
          - if the lost track had a known speed, the new point is ahead of
            it (not behind — that would be another object).
        """
        opposite = "right" if side == "left" else "left"
        best_tid = None
        best_dcy = float("inf")
        for tid, (last_side, last_frame, last_cx, last_cy, last_dx) in self._lost.items():
            if last_side != opposite:
                continue
            gap = self._frame - last_frame
            if gap > self.reid_window:
                continue
            dcy = abs(cy - last_cy)
            if dcy > self.vertical_dist:
                continue
            shift = cx - last_cx
            if abs(shift) > self.reid_max_speed * max(gap, 1):
                continue
            if abs(last_dx) >= 2.0 and shift * last_dx < 0:
                continue   # it was moving the other way — not the same object
            if dcy < best_dcy:
                best_dcy = dcy
                best_tid = tid
        return best_tid

    def _update_lost(self, active_ids: set[int]) -> None:
        """Moves missing IDs from active → lost; expires old lost IDs."""
        for tid in set(self._active.keys()) - active_ids:
            side, cx, cy, dx = self._active.pop(tid)
            self._lost[tid] = (side, self._frame, cx, cy, dx)

        cleanup_window = max(self.reid_window, self.same_side_window)
        expired = [
            tid for tid, (_, f, _cx, _cy, _dx) in self._lost.items()
            if self._frame - f > cleanup_window
        ]
        for tid in expired:
            del self._lost[tid]
            self._counted.discard(tid)
