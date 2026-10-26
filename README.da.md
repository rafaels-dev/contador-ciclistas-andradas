# Traffic Counter

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Nederlands](README.nl.md) · [Italiano](README.it.md) · **Dansk**

Et skrivebordsprogram, der tæller **cyklister, fodgængere, biler, motorcykler, løbehjul, el-knallerter og ethjulede** i videoer fra faste gadekameraer. En person gennemgår hver tælling før det endelige resultat.

Det blev lavet til forskning i bymobilitet (det startede med cykelstikameraet i Andradas i Brasilien) og virker med enhver video fra et kamera, der ikke bevæger sig. Appen taler engelsk, portugisisk, spansk, fransk, tysk, nederlandsk, italiensk og dansk. Den følger computerens sprog, og du kan vælge et andet under **Indstillinger**.

## Sådan virker det

1. **Vælg videoen.** Brug en fil på din computer eller et Google Drive-link.
2. **Tegn tællelinjerne.** De kan ligge i en hvilken som helst vinkel (cykelsti, fortov, en kørebane), og du vælger, hvad hver linje tæller. På 4K-videoer fra et højt placeret kamera markerer du også analyseområdet.
3. **Registrering.** Appen finder og følger alt, der bevæger sig, med YOLO-objektgenkendelse plus bevægelsesregistrering. Den kører på et NVIDIA-grafikkort eller på processoren.
4. **Forslag.** En billedmodel, som kaldes via OpenRouter med din egen nøgle, foreslår kategorien for hvert objekt, der krydsede en linje. Prompten og kategorinavnene følger appens sprog.
5. **Gennemgang.** Du tjekker hvert objekt i en editor med klippet, den originale video og en tidslinje, og du godkender eller retter forslaget. Tastaturgenveje og godkendelse i ét hug af de sikre tilfælde gør det hurtigt.
6. **Færdig video.** Du får en MP4 med linjerne, tællingerne og et panel med totaler samt et regneark (`events.csv`) og en rapport (`report.json`). Flere videoer (f.eks. timerne i en dag) kan blive til én færdig video, hvor totalerne lægges sammen.

## Download og installation

Download installationsprogrammet til den nyeste version under **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)**:

| System | Fil |
|---|---|
| Windows 10/11 (64-bit) | `TrafficCounter-Setup-<version>.exe` |
| macOS (Apple-chip) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` eller `.deb` |

Installationsprogrammet beder ikke om administratorrettigheder, og appen opdaterer sig selv. Når en ny version er klar, vises et banner med **Genstart og opdater**.

Første gang sætter en guide fire ting op:

- **Sprog.** Computerens sprog eller et andet.
- **Grafikkort.** Appen bruger et NVIDIA-kort, hvis der er et (meget hurtigere). Du kan vælge kun at bruge processoren.
- **Registreringsmotor.** Appen downloader og installerer Python og AI-bibliotekerne: cirka 1 GB uden NVIDIA-kort, 2,5 GB med, og op til ~6 GB på disken.
- **OpenRouter-nøgle.** OpenRouter er den tjeneste, du betaler for efter forbrug, og som laver forslagene. Hvert forslag koster en brøkdel af en cent: to timers video fra en travl boulevard kostede cirka US$ 0,10. Opret en nøgle på [openrouter.ai](https://openrouter.ai/keys), og indsæt den i appen, som tester den, før den gemmes.

**Krav:**
- Et NVIDIA-grafikkort (valgfrit, anbefales).
- Diskplads til motoren (~6 GB) og til de færdige videoer.
- Internet til at installere motoren og til forslagene.

**Hvis noget går galt:** gå til **Indstillinger → Hjælp og diagnosticering**, klik på **Gem diagnoserapport**, og send `.zip`-filen til den, der yder dig support. Den indeholder programmets log og hvad der skete med hver video. Den indeholder ikke videoerne eller din nøgle.

Opdatering fra 0.0.7 eller tidligere (da appen hed "Contador de Tráfego"): appen flytter dine data over til det nye navn første gang, den starter. Intet bliver registreret igen, og ingen gennemgang går tabt.

## Privatliv

Videoerne behandles **på din computer** og sendes ingen steder hen. Appen kommunikerer kun med andre systemer i disse tilfælde:

| Hvornår | Hvortil | Hvad der sendes |
|---|---|---|
| Kategoriforslag (med den nøgle, du har sat op) | [OpenRouter](https://openrouter.ai/privacy) og den modeludbyder, den sender videre til (standard: Anthropic; reserver: DeepSeek og Google) | Små udsnit af hvert kandidatobjekt (en række udsnit og krydsningsbilledet som JPEG). Intet andet fra videoen. |
| Du indsætter et Google Drive-link | [Google Drive](https://policies.google.com/privacy) | Downloadanmodningen for den linkede fil. |
| Installation af motoren (første kørsel eller "Installer nu") | GitHub (Python), [PyPI](https://pypi.org) og download.pytorch.org | Downloadanmodninger for bibliotekerne. |
| Opdateringer (når appen åbnes og hver 4. time) | Dette repositorys [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) | Et tjek efter den nyeste version og, hvis der er en, download af den. |

Der er ingen telemetri, ingen brugerkonto og ingen indsamling af brugsdata. Diagnoserapporten oprettes kun, når du beder om den. Den gemmes på din computer og udelader OpenRouter-nøglen.

## Politik for kodesignering (Code signing policy)

Installationsprogrammerne bygges af GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) direkte fra koden i dette repository, ud fra hvert `v*`-tag. Der er ansøgt om gratis kodesignering til open source-projekter hos [SignPath Foundation](https://signpath.org). Indtil den er på plads, advarer Windows og macOS ved første start om, at appen kommer fra en ukendt udvikler.

Team:

- Committers (commits uden yderligere gennemgang): [Rafael Schettino](https://github.com/rafaels-dev)
- Reviewers: [Rafael Schettino](https://github.com/rafaels-dev)
- Approvers (godkender hver signering): [Rafael Schettino](https://github.com/rafaels-dev)

Enhver ændring af `main`-grenen skal bestå de automatiske tests ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)), før den kan merges.

Privatliv: se afsnittet [Privatliv](#privatliv). Dette program overfører ingen oplysninger til andre netværkssystemer, medmindre brugeren eller den person, der installerer eller driver det, specifikt beder om det, bortset fra i de tilfælde, der er nævnt der.

## For udviklere

Struktur:

- `web/`: appen (Next.js). Skærmbilleder, SQLite-database, styring af trinene og kaldene til OpenRouter. Oversættelserne ligger i `web/messages/<sprog>.json` (next-intl) og billedprompterne i `web/src/lib/prompts.ts`.
- `worker/`: Python. Registrering og sporing (`detect.py`), færdig video (`render.py`), indlæsning af video med FFmpeg/NVDEC (`reader.py`).
- `desktop/`: Electron og installationsprogrammer (electron-builder). Se [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py`: den oprindelige kommandolinjetæller (automatisk tælling på en lodret linje, uden gennemgang), bevaret til batch- og realtidsbehandling.
- `evaluation/`: værktøjer til at evaluere tællingen og kalibrere modellerne.
- `tests/`, `web/src/**/*.test.ts` og `web/evals/`: automatiske tests og prompt-evals.

For at køre appen under udvikling skal du have Python 3.11 med afhængighederne og Node.js 22+:

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # eller cu126 til NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Tests (de samme som i CI, krævet for at merge til `main`):

```bash
python -m pytest                      # worker og counter (i roden)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # billedprompten på alle sprog (koster penge; se web/evals/README.md)
```

Tilføj et sprog: læg en `web/messages/<kode>.json` med alle nøglerne fra `en.json`, en post i `web/src/i18n/locales.ts` og prompten i `web/src/lib/prompts.ts`. Kør derefter prompt-evals.

Kommandolinjetæller:

```bash
python process_video.py --video camera.mp4                 # annoteret video + result.json
python process_video.py --video camera.mp4 --no-video      # kun tal
python stream_realtime.py rtsp://192.168.1.100/cam4         # JSON-hændelser i realtid
```

## Licens

Copyright © 2026 Rafael Schettino.

Dette program er fri software, distribueret under **GNU Affero General Public License, version 3** ([`LICENSE`](LICENSE)). Du kan bruge, studere, ændre og videredistribuere det. Hvis du distribuerer ændrede versioner eller tilbyder dem til andre over et netværk, skal du gøre kildekoden tilgængelig under samme licens.

Vigtigste tredjepartskomponenter, alle open source:

| Komponent | Licens |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) og vægtene `yolov8n.pt` (inklusive finjusteringen i `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (via imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |
