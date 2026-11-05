# Desktop app (Windows, macOS, Linux)

Packages the review app (`web/`) as an installable program, in the style of Spotify:

- **Installation:** installs per user, without asking for an administrator password, and opens when done.
- **Window:** frameless, with the title bar drawn by the app itself.
- **Updates:** downloads in the background from the GitHub Releases (electron-updater) and installs on close; a banner offers "Restart and update".

## How it works

- **Electron** (`main.cjs`): opens the window and starts the *standalone* Next server in a child process, on a free `127.0.0.1` port. The minimal bridge with the page is `preload.cjs` (`window.trafficCounterDesktop`): platform, window button colors per theme, the native file dialog and the update.
- **Server access:** on every run Electron draws a token (`TRAFFIC_COUNTER_TOKEN`) and gives it only to its window, as a cookie. `web/src/proxy.ts` refuses requests without the token or with a `Host` other than `127.0.0.1:<port>`, which stops other programs on the computer and DNS rebinding. The window only navigates inside the app origin; the rest (only `http`/`https`) opens in the default browser.
- **Language:** Electron passes the computer's preferred languages (`TRAFFIC_COUNTER_SYSTEM_LOCALES`); the app uses the first one it supports, unless the user picked another in **Settings**.
- **User data:** in the app data folder.
  - Windows: `%APPDATA%\Traffic Counter`.
  - macOS: `~/Library/Application Support/Traffic Counter`.
  - Linux: `~/.config/Traffic Counter`.
  - Contents: `data/` (database and processed videos), `config.env` (OpenRouter key, editable in **Settings**), `engine/` (Python) and `server.log`.
  - Up to 0.0.7 the folder was `Contador de Tráfego` (with `dados/`, `motor/`, `servidor.log`). The first start of a newer version renames it (`useDataFolder` in `main.cjs`), and the server translates the database and the job files (`web/src/lib/legacy.ts`). The Python environment stays in `motor/`, because moving a venv can break it.
- **First run:** a wizard asks for the language and the graphics card, installs the engine and asks for the AI key (step by step, tested before saving). All of it stays editable in **Settings**.
- **Engine (Python + YOLO):** not in the installer, because PyTorch with CUDA is over 2 GB. The wizard (or **Settings → Install**) uses the bundled `uv` to:
  - download Python 3.11;
  - install PyTorch (with CUDA if there is an NVIDIA card, otherwise for CPU; MPS on the Mac);
  - install `requirements.txt`.
- **Existing Python:** the `PYTHON` variable points the worker to an already installed Python. Without it, the app only uses the environment it installed itself.
- **Pinned versions:** `requirements.txt` and PyTorch have pinned versions, because each machine installs from scratch. Tested on Linux: the processor-only install takes 1.7 GB and detects normally (17 fps on a 1080p clip).

## Building the installers

```bash
cd desktop
npm install
npm run dist:linux   # AppImage + .deb (can be built on WSL)
npm run dist:win     # .exe (NSIS) — run on Windows
npm run dist:mac     # .dmg (arm64 and x64) — run on a Mac
```

`npm run resources` builds `resources/`:

- **Standalone Next server:** built in a clean copy of `web/`, without `data/`. With the videos inside, Turbopack runs out of memory.
- **Worker and weights:** `worker/`, `config.py` and the YOLO weights, in `resources/engine/`.
- **uv:** the system's copy; on CI, downloaded from GitHub.
- **Weights:** `best.pt` comes from the repository; `yolov8n.pt` from the root or, if missing, from the Ultralytics release.

On CI (`.github/workflows/desktop.yml`), a `v*` tag (e.g. `git tag v0.0.1 && git push origin v0.0.1`) builds the three installers and publishes them in the Release, where the installed apps update from. **Actions → Desktop app → Run workflow** builds them by hand, given the version and the system, without publishing. The bicycle fine-tune (`runs/ft_blur/weights/best.pt`, 6 MB) is in git; CI downloads `yolov8n.pt` from Ultralytics.

`appId` (`br.com.contadortrafego.app`) and the package `name` (`contador-trafego`) keep their 0.0.7 values: the installed apps update by them, and the Windows install folder (`%LOCALAPPDATA%\Programs\contador-trafego`) comes from the name.

## Testing without packaging

```bash
cd desktop
npm run dev          # app window over a server already running at http://127.0.0.1:3000 (`next dev` or `npm run production` in web/)
npm run resources && npm start   # with the embedded server, as in the installer
```

## Pending

- **Signing:** without a code certificate, Windows (SmartScreen) and macOS (Gatekeeper) warn on the first start. The Mac uses ad-hoc signing.
- **macOS:** the engine install and detection have not been tested yet. The Mac has no NVDEC, so the worker reads the video on the CPU.

## Validated on Windows (Oct/2026)

Windows 11, RTX 4060: NSIS installer, first-run wizard (graphics card, CUDA engine through `uv`, AI key), import through the native dialog and the path field, detection, suggestions, review, final video (h264_nvenc), downloads, cancelling (`taskkill /T`) and closing with a worker running (nothing is left orphaned). Pitfalls found and fixed:

- `cv2.imwrite` silently returns `False` with an accent in the path — and the data folder was `Contador de Tráfego` (users' names have accents too). The worker writes JPGs with `imencode` + `write_bytes` (`write_jpg` in `worker/reader.py`).
- Windows Python starts in cp1252: JSON events with "→"/"…" crashed the worker. The runner passes `PYTHONUTF8=1` and the scripts reconfigure stdout.
- `fs.readdirSync` lists the compatibility junctions of the user folder ("Application Data", "My Documents"…), which do not open; the folder browser hides them.
