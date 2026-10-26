# Traffic Counter

**English** · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Nederlands](README.nl.md) · [Italiano](README.it.md) · [Dansk](README.da.md)

A desktop app that counts **cyclists, pedestrians, cars, motorcycles, kick scooters, electric mopeds and unicycles** in videos from fixed street cameras. A person reviews every count before the final result.

It was built for urban mobility research (it started with the bike lane camera in Andradas, Brazil) and works with any video from a camera that doesn't move. The app speaks English, Portuguese, Spanish, French, German, Dutch, Italian and Danish. It follows the computer's language, and you can pick another one in **Settings**.

## How it works

1. **Pick the video.** Use a file on your computer or a Google Drive link.
2. **Draw the counting lines.** They can go at any angle (bike lane, sidewalk, a traffic lane), and you choose what each line counts. On 4K videos from a high camera, also mark the analysis area.
3. **Detection.** The app finds and follows everything that moves, using YOLO object detection plus motion detection. It runs on an NVIDIA graphics card or on the processor.
4. **Suggestions.** A vision model, called through OpenRouter with your own key, suggests the category of each object that crossed a line. The prompt and the category names follow the app language.
5. **Review.** You check each object in an editor with the clip, the original video and a timeline, and accept or correct the suggestion. Keyboard shortcuts and bulk accept of the reliable cases keep it fast.
6. **Final video.** You get an MP4 with the lines, the counts and a totals panel, plus a spreadsheet (`events.csv`) and a report (`report.json`). Several videos (the hours of a day, for example) can become a single final video with the totals added up.

## Download and install

Download the installer for the latest version from **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)**:

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `TrafficCounter-Setup-<version>.exe` |
| macOS (Apple chip) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` or `.deb` |

The installer doesn't ask for administrator rights, and the app updates itself. When a new version is ready, a **Restart and update** banner appears.

The first time, a wizard sets up four things:

- **Language.** The computer's language, or another one.
- **Graphics card.** The app uses an NVIDIA card if there is one (much faster). You can choose the processor only.
- **Detection engine.** The app downloads and installs Python and the AI libraries: about 1 GB without an NVIDIA card, 2.5 GB with one, and up to ~6 GB on disk.
- **OpenRouter key.** OpenRouter is the pay-per-use service that makes the suggestions. Each suggestion costs a fraction of a cent: two hours of video of a busy avenue came to about US$ 0.10. Create a key at [openrouter.ai](https://openrouter.ai/keys) and paste it into the app, which tests it before saving.

**Requirements:**
- An NVIDIA graphics card (optional, recommended).
- Disk space for the engine (~6 GB) and for the final videos.
- Internet, to install the engine and for the suggestions.

**If something goes wrong:** go to **Settings → Help and diagnostics**, click **Save diagnostics report**, and send the `.zip` file to whoever supports you. It contains the program log and what happened to each video. It does not contain the videos or your key.

Updating from 0.0.7 or earlier (when the app was called "Contador de Tráfego"): the app moves your data to the new name the first time it starts. Nothing is detected again and no review is lost.

## Privacy

Videos are processed **on your computer** and are not sent anywhere. The app only talks to other systems in these cases:

| When | Where to | What goes |
|---|---|---|
| Category suggestions (with the key you set up) | [OpenRouter](https://openrouter.ai/privacy) and the model provider it routes to (default: Anthropic; fallbacks: DeepSeek and Google) | Small crops of each candidate object (a sequence of crops and the crossing frame, as JPEG). Nothing else from the video. |
| You paste a Google Drive link | [Google Drive](https://policies.google.com/privacy) | The download request for the linked file. |
| Engine installation (first run or "Install now") | GitHub (Python), [PyPI](https://pypi.org) and download.pytorch.org | Download requests for the libraries. |
| Updates (when the app opens and every 4 h) | This repository's [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) | A check for the latest version and, if there is one, its download. |

There is no telemetry, no user account and no usage data collection. The diagnostics report is only created when you ask for it. It is saved on your computer and leaves out the OpenRouter key.

## Code signing policy

The installers are built by GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) straight from this repository's code, from each `v*` tag. Free code signing for open source projects has been requested from the [SignPath Foundation](https://signpath.org). Until it arrives, Windows and macOS warn on the first start that the app comes from an unidentified developer.

Team:

- Committers (commits without additional review): [Rafael Schettino](https://github.com/rafaels-dev)
- Reviewers: [Rafael Schettino](https://github.com/rafaels-dev)
- Approvers (approve each signing): [Rafael Schettino](https://github.com/rafaels-dev)

Every change to the `main` branch must pass the automated tests ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) before it can be merged.

Privacy: see the [Privacy](#privacy) section. This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, except in the cases listed there.

## For developers

Layout:

- `web/`: the app (Next.js). Screens, SQLite database, step orchestration and the OpenRouter calls. Translations are in `web/messages/<language>.json` (next-intl) and the vision prompts in `web/src/lib/prompts.ts`.
- `worker/`: Python. Detection and tracking (`detect.py`), final video (`render.py`), video reading with FFmpeg/NVDEC (`reader.py`).
- `desktop/`: Electron and installers (electron-builder). See [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py`: the original command-line counter (automatic counting on a vertical line, without review), kept for batch and real-time processing.
- `evaluation/`: tools to evaluate the counting and calibrate the models.
- `tests/`, `web/src/**/*.test.ts` and `web/evals/`: automated tests and prompt evals.

To run the app in development, you need Python 3.11 with the dependencies and Node.js 22+:

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # or cu126 for NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Tests (the same as CI, required to merge into `main`):

```bash
python -m pytest                      # worker and counter (at the root)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # vision prompt in every language (paid; see web/evals/README.md)
```

Adding a language: add a `web/messages/<code>.json` with every key of `en.json`, an entry in `web/src/i18n/locales.ts`, and the prompt in `web/src/lib/prompts.ts`. Then run the prompt evals.

Command-line counter:

```bash
python process_video.py --video camera.mp4                 # annotated video + result.json
python process_video.py --video camera.mp4 --no-video      # numbers only
python stream_realtime.py rtsp://192.168.1.100/cam4         # JSON events in real time
```

## License

Copyright © 2026 Rafael Schettino.

This program is free software, distributed under the **GNU Affero General Public License, version 3** ([`LICENSE`](LICENSE)). You can use, study, modify and redistribute it. If you distribute modified versions, or offer them to other people over a network, you must make the source code available under the same license.

Main third-party components, all open source:

| Component | License |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) and the `yolov8n.pt` weights (including the fine-tune in `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (via imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |
