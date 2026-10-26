"""CountingLine (counter/line.py), used by the command-line modes: only
counts what crosses the line, once per object, including when ByteTrack
switches the id right on it — and does not count when the switch is not
physically plausible."""
import numpy as np
import supervision as sv

from counter.line import CountingLine

LINE_X = 500


def frame(*objects) -> sv.Detections:
    """objects: (tracker_id, cx, cy) with 40×80 boxes."""
    if not objects:
        return sv.Detections.empty()
    xyxy = np.array([[cx - 20, cy - 40, cx + 20, cy + 40] for _, cx, cy in objects], dtype=float)
    return sv.Detections(xyxy=xyxy, tracker_id=np.array([t for t, _, _ in objects]))


def run(line: CountingLine, frames) -> CountingLine:
    for objects in frames:
        line.trigger(frame(*objects))
    return line


def moving(tid, x0, x1, n=10, cy=300):
    return [[(tid, x0 + (x1 - x0) * i / (n - 1), cy)] for i in range(n)]


def test_left_to_right_counts_out():
    l = run(CountingLine(LINE_X), moving(1, 300, 700))
    assert (l.in_count, l.out_count) == (0, 1)
    assert l.events[0]["reason"] == "centroid"


def test_right_to_left_counts_in():
    l = run(CountingLine(LINE_X), moving(1, 700, 300))
    assert (l.in_count, l.out_count) == (1, 0)


def test_no_crossing_no_count():
    l = run(CountingLine(LINE_X), moving(1, 100, 450))
    assert l.in_count + l.out_count == 0


def test_back_and_forth_counts_once():
    l = run(CountingLine(LINE_X), moving(1, 300, 700) + moving(1, 700, 300))
    assert l.in_count + l.out_count == 1


def test_same_id_vanishes_and_comes_back_on_the_other_side():
    frames = moving(1, 300, 480, n=5) + [[]] * 3 + moving(1, 560, 700, n=5)
    l = run(CountingLine(LINE_X), frames)
    assert l.out_count == 1
    assert l.events[0]["reason"] == "centroid_gap"


def test_new_id_on_the_other_side_counts_once():
    # the track breaks mid-crossing: id 1 vanishes on the left, id 2 shows up on the right
    frames = moving(1, 300, 480, n=10) + [[]] * 2 + moving(2, 540, 700, n=8)
    l = run(CountingLine(LINE_X), frames)
    assert l.out_count == 1
    assert l.events[0]["reason"] == "reid_opposite"


def test_new_id_against_the_velocity_is_not_the_same_object():
    # id 1 was moving LEFT (away from the line) and vanished; a new id on the
    # other side cannot be it
    frames = moving(1, 490, 400, n=10) + [[]] * 2 + moving(2, 520, 700, n=8)
    l = run(CountingLine(LINE_X), frames)
    assert l.in_count + l.out_count == 0


def test_new_id_in_another_lane_is_not_the_same_object():
    frames = moving(1, 300, 480, n=10) + [[]] * 2 + moving(2, 540, 700, n=8, cy=700)
    l = run(CountingLine(LINE_X), frames)
    assert l.in_count + l.out_count == 0


def test_new_id_too_fast_is_not_the_same_object():
    frames = moving(1, 300, 480, n=10) + [[]] * 2 + moving(2, 900, 1000, n=4)
    l = run(CountingLine(LINE_X, reid_max_speed=50), frames)
    assert l.in_count + l.out_count == 0


def test_same_side_reid_inherits_already_counted():
    # crossed (counted), vanished behind an occlusion and came back with a new id on the same side
    frames = moving(1, 300, 700, n=10) + [[]] * 3 + moving(2, 720, 300, n=10)
    l = run(CountingLine(LINE_X), frames)
    assert l.in_count + l.out_count == 1


def test_duplicate_box_glued_to_a_counted_track_does_not_count():
    frames = moving(1, 300, 700, n=10)
    # after the count, YOLO gives the same object a second box with another id;
    # track 1 vanishes and the duplicate box goes on alone (and back over the line)
    frames += [[(1, 700 + 10 * i, 300), (2, 690 + 10 * i, 310)] for i in range(1, 4)]
    frames += moving(2, 720, 300, n=10)
    l = run(CountingLine(LINE_X), frames)
    assert l.in_count + l.out_count == 1


def test_different_objects_count_separately():
    there = moving(1, 300, 700)
    back = moving(2, 700, 300, cy=600)
    l = run(CountingLine(LINE_X), [a + b for a, b in zip(there, back)])
    assert (l.in_count, l.out_count) == (1, 1)


def test_edge_entry_only_in_legacy_mode():
    enters = [[(1, 980 - 10 * i, 300)] for i in range(5)]  # shows up at the right edge and does not cross
    assert run(CountingLine(LINE_X, frame_width=1000), enters).in_count == 0
    l = run(CountingLine(LINE_X, frame_width=1000, count_on_entry=True), enters)
    assert l.in_count == 1 and l.events[0]["reason"] == "entry"
