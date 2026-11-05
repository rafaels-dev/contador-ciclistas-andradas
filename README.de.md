# Traffic Counter

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Nederlands](README.nl.md) · [Italiano](README.it.md) · [Dansk](README.da.md)

Eine Desktop-App, die **Radfahrer, Fußgänger, Autos, Motorräder, Tretroller, Elektroroller und Einräder** in Videos von fest installierten Straßenkameras zählt. Jede Zählung wird von einem Menschen geprüft, bevor das Endergebnis feststeht.

Sie wurde für die Forschung zur städtischen Mobilität entwickelt (angefangen hat es mit der Radwegkamera in Andradas, Brasilien) und funktioniert mit jedem Video einer Kamera, die sich nicht bewegt. Die App spricht Englisch, Portugiesisch, Spanisch, Französisch, Deutsch, Niederländisch, Italienisch und Dänisch. Sie folgt der Sprache des Computers, und Sie können in den **Einstellungen** eine andere wählen.

## So funktioniert es

1. **Video auswählen.** Verwenden Sie eine Datei auf Ihrem Computer oder einen Google-Drive-Link.
2. **Zähllinien zeichnen.** Sie können in beliebigem Winkel verlaufen (Radweg, Gehweg, eine Fahrspur), und Sie legen fest, was jede Linie zählt. Bei 4K-Videos einer hoch montierten Kamera markieren Sie außerdem den Analysebereich.
3. **Erkennung.** Die App findet und verfolgt alles, was sich bewegt – mit YOLO-Objekterkennung plus Bewegungserkennung. Sie läuft auf einer NVIDIA-Grafikkarte oder auf dem Prozessor.
4. **Vorschläge.** Ein Bildmodell, das über OpenRouter mit Ihrem eigenen Schlüssel aufgerufen wird, schlägt die Kategorie jedes Objekts vor, das eine Linie überquert hat. Der Prompt und die Kategorienamen folgen der Sprache der App.
5. **Prüfung.** Sie prüfen jedes Objekt in einem Editor mit dem Clip, dem Originalvideo und einer Zeitleiste und übernehmen oder korrigieren den Vorschlag. Tastenkürzel und das gesammelte Übernehmen der sicheren Fälle machen das schnell.
6. **Endvideo.** Sie erhalten ein MP4 mit den Linien, den Zählungen und einer Summentafel, dazu eine Tabelle (`events.csv`) und einen Bericht (`report.json`). Mehrere Videos (zum Beispiel die Stunden eines Tages) können zu einem einzigen Endvideo mit addierten Summen werden.

## Herunterladen und installieren

Laden Sie das Installationsprogramm der neuesten Version unter **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)** herunter:

| System | Datei |
|---|---|
| Windows 10/11 (64 Bit) | `TrafficCounter-Setup-<version>.exe` |
| macOS (Apple-Chip) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` oder `.deb` |

Das Installationsprogramm braucht keine Administratorrechte, und die App aktualisiert sich selbst. Wenn eine neue Version bereit ist, erscheint ein Banner **Neu starten und aktualisieren**.

Beim ersten Start richtet ein Assistent vier Dinge ein:

- **Sprache.** Die Sprache des Computers oder eine andere.
- **Grafikkarte.** Die App verwendet eine NVIDIA-Karte, wenn eine vorhanden ist (viel schneller). Sie können auch nur den Prozessor wählen.
- **Erkennungs-Engine.** Die App lädt Python und die KI-Bibliotheken herunter und installiert sie: etwa 1 GB ohne NVIDIA-Karte, 2,5 GB mit, und bis zu ~6 GB auf der Festplatte.
- **OpenRouter-Schlüssel.** OpenRouter ist der Dienst mit Bezahlung nach Nutzung, der die Vorschläge macht. Jeder Vorschlag kostet einen Bruchteil eines Cents: Zwei Stunden Video einer viel befahrenen Allee kosteten etwa US$ 0,10. Erstellen Sie einen Schlüssel auf [openrouter.ai](https://openrouter.ai/keys) und fügen Sie ihn in die App ein, die ihn vor dem Speichern testet.

**Voraussetzungen:**
- Eine NVIDIA-Grafikkarte (optional, empfohlen).
- Speicherplatz für die Engine (~6 GB) und für die Endvideos.
- Internet, um die Engine zu installieren und für die Vorschläge.

**Wenn etwas schiefgeht:** Gehen Sie zu **Einstellungen → Hilfe und Diagnose**, klicken Sie auf **Diagnosebericht speichern** und senden Sie die `.zip`-Datei an Ihren Support. Sie enthält das Protokoll des Programms und was mit jedem Video passiert ist. Die Videos und Ihr Schlüssel sind nicht enthalten.

Update von 0.0.7 oder älter (als die App noch „Contador de Tráfego“ hieß): Beim ersten Start verschiebt die App Ihre Daten unter den neuen Namen. Nichts wird neu erkannt, und keine Prüfung geht verloren.

## Datenschutz

Die Videos werden **auf Ihrem Computer** verarbeitet und nirgendwohin gesendet. Die App kommuniziert nur in diesen Fällen mit anderen Systemen:

| Wann | Wohin | Was übertragen wird |
|---|---|---|
| Kategorievorschläge (mit dem von Ihnen eingerichteten Schlüssel) | [OpenRouter](https://openrouter.ai/privacy) und der Modellanbieter, an den es weiterleitet (Standard: Anthropic; Ausweichanbieter: DeepSeek und Google) | Kleine Ausschnitte jedes Kandidatenobjekts (eine Folge von Ausschnitten und das Bild der Überquerung, als JPEG). Sonst nichts aus dem Video. |
| Sie fügen einen Google-Drive-Link ein | [Google Drive](https://policies.google.com/privacy) | Die Download-Anfrage für die verlinkte Datei. |
| Installation der Engine (erster Start oder „Jetzt installieren“) | GitHub (Python), [PyPI](https://pypi.org) und download.pytorch.org | Download-Anfragen für die Bibliotheken. |
| Updates (beim Öffnen der App und alle 4 h) | Die [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) dieses Repositorys | Eine Abfrage der neuesten Version und, falls vorhanden, deren Download. |

Es gibt keine Telemetrie, kein Benutzerkonto und keine Erfassung von Nutzungsdaten. Der Diagnosebericht wird nur erstellt, wenn Sie ihn anfordern. Er wird auf Ihrem Computer gespeichert und enthält den OpenRouter-Schlüssel nicht.

## Richtlinie zur Codesignierung (Code signing policy)

Die Installationsprogramme werden von GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) direkt aus dem Code dieses Repositorys erstellt, aus jedem `v*`-Tag. Eine kostenlose Codesignierung für Open-Source-Projekte wurde bei der [SignPath Foundation](https://signpath.org) beantragt. Bis sie vorliegt, warnen Windows und macOS beim ersten Start, dass die App von einem nicht identifizierten Entwickler stammt.

Team:

- Committer (Commits ohne zusätzliche Prüfung): [Rafael Schettino](https://github.com/rafaels-dev)
- Reviewer: [Rafael Schettino](https://github.com/rafaels-dev)
- Genehmiger (genehmigen jede Signierung): [Rafael Schettino](https://github.com/rafaels-dev)

Jede Änderung am Branch `main` muss die automatisierten Tests ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) bestehen, bevor sie zusammengeführt werden kann.

Datenschutz: siehe den Abschnitt [Datenschutz](#datenschutz). Dieses Programm überträgt keine Informationen an andere vernetzte Systeme, sofern dies nicht ausdrücklich vom Benutzer oder von der Person, die es installiert oder betreibt, angefordert wird – außer in den dort aufgeführten Fällen.

## Für Entwickler

Aufbau:

- `web/`: die App (Next.js). Oberflächen, SQLite-Datenbank, Ablaufsteuerung der Schritte und die Aufrufe an OpenRouter. Die Übersetzungen liegen in `web/messages/<language>.json` (next-intl), die Prompts für das Bildmodell in `web/src/lib/prompts.ts`.
- `worker/`: Python. Erkennung und Verfolgung (`detect.py`), Endvideo (`render.py`), Videolesen mit FFmpeg/NVDEC (`reader.py`).
- `desktop/`: Electron und Installationsprogramme (electron-builder). Siehe [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py`: der ursprüngliche Kommandozeilen-Zähler (automatische Zählung an einer senkrechten Linie, ohne Prüfung), beibehalten für Stapel- und Echtzeitverarbeitung.
- `evaluation/`: Werkzeuge, um die Zählung zu bewerten und die Modelle zu kalibrieren.
- `tests/`, `web/src/**/*.test.ts` und `web/evals/`: automatisierte Tests und Prompt-Evals.

Um die App in der Entwicklung auszuführen, brauchen Sie Python 3.11 mit den Abhängigkeiten und Node.js 22+:

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # oder cu126 für NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Tests (dieselben wie in der CI, Pflicht für das Zusammenführen in `main`):

```bash
python -m pytest                      # Worker und Zähler (im Hauptverzeichnis)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # Prompt des Bildmodells in jeder Sprache (kostenpflichtig; siehe web/evals/README.md)
```

Eine Sprache hinzufügen: Legen Sie eine `web/messages/<code>.json` mit allen Schlüsseln aus `en.json` an, einen Eintrag in `web/src/i18n/locales.ts` und den Prompt in `web/src/lib/prompts.ts`. Führen Sie danach die Prompt-Evals aus.

Kommandozeilen-Zähler:

```bash
python process_video.py --video camera.mp4                 # annotiertes Video + result.json
python process_video.py --video camera.mp4 --no-video      # nur Zahlen
python stream_realtime.py rtsp://192.168.1.100/cam4         # JSON-Ereignisse in Echtzeit
```

## Lizenz

Copyright © 2026 Rafael Schettino.

Dieses Programm ist freie Software und wird unter der **GNU Affero General Public License, Version 3** ([`LICENSE`](LICENSE)) verbreitet. Sie dürfen es verwenden, untersuchen, verändern und weitergeben. Wenn Sie veränderte Versionen verbreiten oder anderen Personen über ein Netzwerk anbieten, müssen Sie den Quellcode unter derselben Lizenz zugänglich machen.

Wichtigste Komponenten von Drittanbietern, alle quelloffen:

| Komponente | Lizenz |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) und die Gewichte `yolov8n.pt` (einschließlich des Fine-Tunings in `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (über imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |
