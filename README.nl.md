# Traffic Counter

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Nederlands** · [Italiano](README.it.md) · [Dansk](README.da.md)

Een desktop-app die **fietsers, voetgangers, auto's, motorfietsen, steps, elektrische scooters en eenwielers** telt in video's van vaste straatcamera's. Een mens controleert elke telling voordat het eindresultaat er is.

De app is gemaakt voor onderzoek naar stedelijke mobiliteit (het begon met de camera bij het fietspad in Andradas, Brazilië) en werkt met elke video van een camera die niet beweegt. De app spreekt Engels, Portugees, Spaans, Frans, Duits, Nederlands, Italiaans en Deens. Hij volgt de taal van de computer, en je kunt een andere kiezen in **Instellingen**.

## Hoe het werkt

1. **Kies de video.** Gebruik een bestand op je computer of een link naar Google Drive.
2. **Teken de tellijnen.** Ze kunnen onder elke hoek liggen (fietspad, stoep, een rijstrook), en je kiest wat elke lijn telt. Markeer bij 4K-video's van een hoog hangende camera ook het analysegebied.
3. **Detectie.** De app vindt en volgt alles wat beweegt, met objectdetectie via YOLO plus bewegingsdetectie. Dat draait op een NVIDIA-videokaart of op de processor.
4. **Suggesties.** Een beeldmodel, aangeroepen via OpenRouter met je eigen sleutel, stelt de categorie voor van elk object dat een lijn passeerde. De prompt en de namen van de categorieën volgen de taal van de app.
5. **Controle.** Je bekijkt elk object in een editor met de clip, de originele video en een tijdlijn, en accepteert of corrigeert de suggestie. Sneltoetsen en het in één keer accepteren van de betrouwbare gevallen houden het snel.
6. **Eindvideo.** Je krijgt een MP4 met de lijnen, de tellingen en een paneel met totalen, plus een spreadsheet (`events.csv`) en een rapport (`report.json`). Meerdere video's (bijvoorbeeld de uren van een dag) kunnen één eindvideo worden waarin de totalen bij elkaar worden opgeteld.

## Downloaden en installeren

Download het installatieprogramma van de nieuwste versie bij **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)**:

| Systeem | Bestand |
|---|---|
| Windows 10/11 (64-bit) | `TrafficCounter-Setup-<version>.exe` |
| macOS (Apple-chip) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` of `.deb` |

Het installatieprogramma vraagt geen beheerdersrechten, en de app werkt zichzelf bij. Als er een nieuwe versie klaarstaat, verschijnt een balk met **Opnieuw starten en bijwerken**.

De eerste keer stelt een assistent vier dingen in:

- **Taal.** De taal van de computer, of een andere.
- **Videokaart.** De app gebruikt een NVIDIA-kaart als die er is (veel sneller). Je kunt ook kiezen voor alleen de processor.
- **Detectiemotor.** De app downloadt en installeert Python en de AI-bibliotheken: ongeveer 1 GB zonder NVIDIA-kaart, 2,5 GB met, en tot ~6 GB op de schijf.
- **OpenRouter-sleutel.** OpenRouter is de dienst waarbij je per gebruik betaalt en die de suggesties maakt. Elke suggestie kost een fractie van een cent: twee uur video van een drukke laan kwam uit op ongeveer US$ 0,10. Maak een sleutel aan op [openrouter.ai](https://openrouter.ai/keys) en plak hem in de app, die hem test voordat hij wordt opgeslagen.

**Vereisten:**
- Een NVIDIA-videokaart (optioneel, aanbevolen).
- Schijfruimte voor de motor (~6 GB) en voor de eindvideo's.
- Internet, om de motor te installeren en voor de suggesties.

**Als er iets misgaat:** ga naar **Instellingen → Hulp en diagnose**, klik op **Diagnoserapport opslaan** en stuur het `.zip`-bestand naar wie je ondersteunt. Het bevat het logboek van het programma en wat er met elke video is gebeurd. Het bevat niet de video's en niet je sleutel.

Bijwerken vanaf 0.0.7 of eerder (toen de app nog "Contador de Tráfego" heette): de app verplaatst je gegevens naar de nieuwe naam de eerste keer dat hij start. Er wordt niets opnieuw gedetecteerd en er gaat geen controle verloren.

## Privacy

Video's worden **op je computer** verwerkt en nergens naartoe gestuurd. De app praat alleen in deze gevallen met andere systemen:

| Wanneer | Waarheen | Wat er wordt verstuurd |
|---|---|---|
| Suggesties voor categorieën (met de sleutel die je hebt ingesteld) | [OpenRouter](https://openrouter.ai/privacy) en de modelaanbieder waar het naartoe routeert (standaard: Anthropic; reserves: DeepSeek en Google) | Kleine uitsneden van elk kandidaat-object (een reeks uitsneden en het beeld van de passage, als JPEG). Verder niets uit de video. |
| Je plakt een Google Drive-link | [Google Drive](https://policies.google.com/privacy) | Het downloadverzoek voor het gelinkte bestand. |
| Installatie van de motor (eerste start of "Nu installeren") | GitHub (Python), [PyPI](https://pypi.org) en download.pytorch.org | Downloadverzoeken voor de bibliotheken. |
| Updates (als de app opent en elke 4 uur) | De [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) van deze repository | Een controle op de nieuwste versie en, als die er is, de download ervan. |

Er is geen telemetrie, geen gebruikersaccount en geen verzameling van gebruiksgegevens. Het diagnoserapport wordt alleen gemaakt als je erom vraagt. Het wordt op je computer opgeslagen en laat de OpenRouter-sleutel weg.

## Beleid voor codeondertekening (Code signing policy)

De installatieprogramma's worden gebouwd door GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) rechtstreeks uit de code van deze repository, vanaf elke `v*`-tag. Gratis codeondertekening voor opensourceprojecten is aangevraagd bij de [SignPath Foundation](https://signpath.org). Tot die er is, waarschuwen Windows en macOS bij de eerste start dat de app van een onbekende ontwikkelaar komt.

Team:

- Committers (commits zonder extra controle): [Rafael Schettino](https://github.com/rafaels-dev)
- Reviewers: [Rafael Schettino](https://github.com/rafaels-dev)
- Approvers (keuren elke ondertekening goed): [Rafael Schettino](https://github.com/rafaels-dev)

Elke wijziging aan de branch `main` moet de automatische tests doorstaan ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) voordat hij kan worden samengevoegd.

Privacy: zie de sectie [Privacy](#privacy). Dit programma draagt geen informatie over naar andere systemen in het netwerk, tenzij de gebruiker of de persoon die het installeert of beheert daar uitdrukkelijk om vraagt, behalve in de gevallen die daar staan.

## Voor ontwikkelaars

Opbouw:

- `web/`: de app (Next.js). Schermen, SQLite-database, aansturing van de stappen en de aanroepen naar OpenRouter. De vertalingen staan in `web/messages/<language>.json` (next-intl) en de prompts voor het beeldmodel in `web/src/lib/prompts.ts`.
- `worker/`: Python. Detectie en tracking (`detect.py`), eindvideo (`render.py`), video lezen met FFmpeg/NVDEC (`reader.py`).
- `desktop/`: Electron en installatieprogramma's (electron-builder). Zie [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py`: de oorspronkelijke teller voor de opdrachtregel (automatisch tellen op een verticale lijn, zonder controle), behouden voor batch- en realtimeverwerking.
- `evaluation/`: hulpmiddelen om het tellen te evalueren en de modellen te kalibreren.
- `tests/`, `web/src/**/*.test.ts` en `web/evals/`: automatische tests en evaluaties van de prompts.

Om de app in ontwikkelmodus te draaien heb je Python 3.11 met de afhankelijkheden en Node.js 22+ nodig:

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # of cu126 voor NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Tests (dezelfde als in de CI, verplicht om in `main` samen te voegen):

```bash
python -m pytest                      # worker en teller (in de hoofdmap)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # prompt voor het beeldmodel in elke taal (betaald; zie web/evals/README.md)
```

Een taal toevoegen: voeg een `web/messages/<code>.json` toe met elke sleutel van `en.json`, een vermelding in `web/src/i18n/locales.ts` en de prompt in `web/src/lib/prompts.ts`. Draai daarna de evaluaties van de prompts.

Teller voor de opdrachtregel:

```bash
python process_video.py --video camera.mp4                 # geannoteerde video + result.json
python process_video.py --video camera.mp4 --no-video      # alleen de getallen
python stream_realtime.py rtsp://192.168.1.100/cam4         # JSON-gebeurtenissen in realtime
```

## Licentie

Copyright © 2026 Rafael Schettino.

Dit programma is vrije software, verspreid onder de **GNU Affero General Public License, versie 3** ([`LICENSE`](LICENSE)). Je mag het gebruiken, bestuderen, aanpassen en opnieuw verspreiden. Als je aangepaste versies verspreidt, of ze via een netwerk aan anderen aanbiedt, moet je de broncode beschikbaar stellen onder dezelfde licentie.

Belangrijkste onderdelen van derden, allemaal open source:

| Onderdeel | Licentie |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) en de gewichten `yolov8n.pt` (inclusief de fine-tune in `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (via imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |
