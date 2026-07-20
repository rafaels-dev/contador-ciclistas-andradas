# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A computer-vision tool that watches street-camera footage and counts four independent categories of traffic — ciclistas (cyclists), pedestres (pedestrians), automóveis (cars/buses/trucks), motocicletas (motorcycles) — as they cross a vertical counting line. Built specifically for camera CAM 4 in Andradas (Intelbras, 1920x1080 @ 15fps, side-on view), but works with any fixed-camera footage.

Two entry points share the same core (`contador/`):
- `processar_video.py` — batch mode: reads a video file end-to-end, writes an annotated H.264 video + a JSON report.
- `stream_tempo_real.py` — real-time mode: reads RTSP/webcam/file, emits newline-delimited JSON events to stdout (for piping into Kafka/MQTT/a database), optionally shows a live OpenCV window.

## Commands

```bash
# setup
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# batch processing (writes Andradas_anotado.mp4 + resultado.json)
python processar_video.py
python processar_video.py --video outro.mp4 --saida saida.mp4 --json saida.json
python processar_video.py --sem-video              # stats only, no video (much faster — use this while iterating)
python processar_video.py --inicio 30 --fim 90      # process only seconds 30–90, for fast iteration on one clip

# real-time streaming (prints JSON events to stdout)
python stream_tempo_real.py rtsp://192.168.1.100/cam4 --cam-id CAM4
python stream_tempo_real.py Andradas.mp4
python stream_tempo_real.py 0 --sem-janela          # webcam, no display window
python stream_tempo_real.py rtsp://... --pular 1    # skip every other frame to cut CPU load
```

There is no test suite, linter, or type-checker configured. Validate changes by running `processar_video.py --sem-video --inicio X --fim Y` on a short slice of `Andradas.mp4` and checking the printed per-category totals and `resultado.json` against expectations (or by eyeballing `Andradas_anotado.mp4`).

## Architecture

**Single YOLO inference per frame, then split into 4 independent pipelines.** `ContadorVeiculos.processar()` (`contador/detector.py`) is the shared core used by both entry points:

1. One `YOLOv8n` call detects all relevant COCO classes at once (person, bicycle, car, bus, truck, motorcycle).
2. Detections are partitioned into 4 mutually-exclusive categories. The tricky part is `person`: a person is a **ciclista** if a `bicycle` is within `DIST_MAX_CYCLIST_PX` of its centroid, a **pedestre** if no bicycle or motorcycle is nearby, or discarded entirely if a `motorcycle` is nearby (assumed to be the rider/pillion, already counted as a motorcycle — must not double-count as a pedestrian).
3. Each category gets its own `sv.ByteTrack()` tracker (independent ID spaces) and its own `LinhaContagem` (independent counting line state) — categories never interfere with each other's IDs or counts.
4. Each `LinhaContagem.trigger()` call returns which detections just crossed the line this frame, in which direction.

**`LinhaContagem` (`contador/linha.py`) is the trickiest piece of logic in the codebase** — read it fully before touching counting behavior. It does NOT use `supervision`'s built-in `LineZone` because that fails on large objects (bbox overlaps the line before/after the true crossing) and fast vehicles (bbox gets clipped at the frame edge, so ByteTrack loses and re-assigns a new ID mid-crossing). Instead it combines:
- Centroid-crossing detection (`cx` crosses `linha_x`) for tracks that persist through the crossing.
- Frame-edge entry detection (`margem_borda`) for objects first seen already at the frame boundary.
- Two re-ID heuristics for broken tracks, keyed on where a lost ID was last seen: **same-side re-ID** (`janela_mesmo_lado`, `dist_spatial`) merges a new ID with a recently-lost one at a similar position without counting again (handles partial occlusion / brief redetection); **opposite-side re-ID** (`janela_reid`) counts once when a fast-moving object's track broke exactly at the line.
- A `_contados` set guarantees no ID is ever counted twice, and expired lost-IDs are pruned so ByteTrack can safely reuse the numeric ID later.

When changing counting logic, preserve this idempotency guarantee — it's easy to accidentally double-count or under-count by changing the order of the re-ID checks in `trigger()`.

**Category-specific config lives in `config.py`**, not hardcoded — `LINHA_X` (counting line position), `CONFIANCA` (detection confidence threshold), `DIST_MAX_CYCLIST_PX` (person↔bicycle association distance), and the COCO class-ID groupings per category. This is the first place to look when adapting the tool to a different camera/location.

**Video writer abstraction (`processar_video.py::_Writer`)**: pipes raw frames to `ffmpeg` (system install or the one bundled via `imageio_ffmpeg`) to encode H.264, falling back to OpenCV's `mp4v` writer only if no ffmpeg is found anywhere. This keeps output file size close to the original instead of the much larger default OpenCV codec.

**`contador/visualizador.py`** (`anotar_frame`) draws bboxes/traces/labels per category in a distinct color, the counting line, a red screen-flash on any new count event, and the stats panel — purely cosmetic, only invoked when annotated video output is requested (skipped entirely by `--sem-video`).

## Output data model

Both entry points produce events keyed by category (`ciclistas`/`pedestres`/`automoveis`/`motocicletas`), each carrying a running total plus `in`/`out` directional counts (`in` = right→left, `out` = left→right, per `LinhaContagem`). `processar_video.py` accumulates these into one `resultado.json` at the end; `stream_tempo_real.py` emits them as they happen (plus `inicio`/`heartbeat`/`encerramento` lifecycle events) so downstream consumers don't need to wait for the stream to end.
