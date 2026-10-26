# Traffic Counter

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Nederlands](README.nl.md) · **Italiano** · [Dansk](README.da.md)

Un'app desktop che conta **ciclisti, pedoni, automobili, motociclette, monopattini, scooter elettrici e monocicli** nei video di telecamere stradali fisse. Una persona rivede ogni conteggio prima del risultato finale.

È nata per la ricerca sulla mobilità urbana (è partita dalla telecamera della pista ciclabile di Andradas, in Brasile) e funziona con qualsiasi video di una telecamera che non si muove. L'app parla inglese, portoghese, spagnolo, francese, tedesco, olandese, italiano e danese. Segue la lingua del computer, e puoi sceglierne un'altra nelle **Impostazioni**.

## Come funziona

1. **Scegli il video.** Usa un file del tuo computer o un link di Google Drive.
2. **Disegna le linee di conteggio.** Possono avere qualsiasi angolazione (pista ciclabile, marciapiede, una corsia) e scegli tu cosa conta ogni linea. Nei video 4K ripresi da una telecamera alta, segna anche l'area di analisi.
3. **Rilevamento.** L'app trova e segue tutto ciò che si muove, con il rilevamento di oggetti YOLO più il rilevamento del movimento. Funziona su una scheda video NVIDIA o sul processore.
4. **Suggerimenti.** Un modello di visione, chiamato tramite OpenRouter con la tua chiave, suggerisce la categoria di ogni oggetto che ha attraversato una linea. Il prompt e i nomi delle categorie seguono la lingua dell'app.
5. **Revisione.** Controlli ogni oggetto in un editor con la clip, il video originale e una timeline, e accetti o correggi il suggerimento. Le scorciatoie da tastiera e l'accettazione in blocco dei casi affidabili rendono il lavoro veloce.
6. **Video finale.** Ottieni un MP4 con le linee, i conteggi e un pannello dei totali, più un foglio di calcolo (`events.csv`) e un rapporto (`report.json`). Più video (le ore di una giornata, per esempio) possono diventare un unico video finale con i totali sommati.

## Download e installazione

Scarica il programma di installazione dell'ultima versione da **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)**:

| Sistema | File |
|---|---|
| Windows 10/11 (64 bit) | `TrafficCounter-Setup-<version>.exe` |
| macOS (chip Apple) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` o `.deb` |

Il programma di installazione non chiede i diritti di amministratore e l'app si aggiorna da sola. Quando una nuova versione è pronta, compare una barra **Riavvia e aggiorna**.

La prima volta, una procedura guidata configura quattro cose:

- **Lingua.** La lingua del computer, o un'altra.
- **Scheda video.** L'app usa una scheda NVIDIA se c'è (molto più veloce). Puoi scegliere di usare solo il processore.
- **Motore di rilevamento.** L'app scarica e installa Python e le librerie di intelligenza artificiale: circa 1 GB senza una scheda NVIDIA, 2,5 GB con una, e fino a ~6 GB su disco.
- **Chiave OpenRouter.** OpenRouter è il servizio a consumo che produce i suggerimenti. Ogni suggerimento costa una frazione di centesimo: due ore di video di un viale trafficato sono costate circa US$ 0,10. Crea una chiave su [openrouter.ai](https://openrouter.ai/keys) e incollala nell'app, che la verifica prima di salvarla.

**Requisiti:**
- Una scheda video NVIDIA (facoltativa, consigliata).
- Spazio su disco per il motore (~6 GB) e per i video finali.
- Internet, per installare il motore e per i suggerimenti.

**Se qualcosa va storto:** vai su **Impostazioni → Assistenza e diagnostica**, fai clic su **Salva il rapporto diagnostico** e invia il file `.zip` a chi ti fornisce assistenza. Contiene il registro del programma e ciò che è successo con ogni video. Non contiene i video né la tua chiave.

Aggiornamento dalla 0.0.7 o precedenti (quando l'app si chiamava "Contador de Tráfego"): al primo avvio l'app sposta i tuoi dati sotto il nuovo nome. Non viene rilevato nulla di nuovo e nessuna revisione va persa.

## Privacy

I video vengono elaborati **sul tuo computer** e non vengono inviati da nessuna parte. L'app comunica con altri sistemi solo in questi casi:

| Quando | Verso dove | Cosa viene inviato |
|---|---|---|
| Suggerimenti di categoria (con la chiave che hai configurato) | [OpenRouter](https://openrouter.ai/privacy) e il fornitore del modello a cui inoltra la richiesta (predefinito: Anthropic; riserve: DeepSeek e Google) | Piccoli ritagli di ogni oggetto candidato (una sequenza di ritagli e il fotogramma dell'attraversamento, in JPEG). Nient'altro del video. |
| Incolli un link di Google Drive | [Google Drive](https://policies.google.com/privacy) | La richiesta di download del file indicato. |
| Installazione del motore (primo avvio o "Installa ora") | GitHub (Python), [PyPI](https://pypi.org) e download.pytorch.org | Le richieste di download delle librerie. |
| Aggiornamenti (all'apertura dell'app e ogni 4 h) | Le [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) di questo repository | Un controllo dell'ultima versione e, se ce n'è una, il suo download. |

Non c'è telemetria, nessun account utente e nessuna raccolta di dati di utilizzo. Il rapporto diagnostico viene creato solo quando lo chiedi tu. Viene salvato sul tuo computer ed esclude la chiave OpenRouter.

## Politica di firma del codice (Code signing policy)

I programmi di installazione sono compilati da GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) direttamente dal codice di questo repository, a partire da ogni tag `v*`. È stata richiesta alla [SignPath Foundation](https://signpath.org) la firma del codice gratuita per i progetti open source. Finché non arriva, al primo avvio Windows e macOS avvisano che l'app proviene da uno sviluppatore non identificato.

Team:

- Committer (commit senza revisione aggiuntiva): [Rafael Schettino](https://github.com/rafaels-dev)
- Revisori: [Rafael Schettino](https://github.com/rafaels-dev)
- Approvatori (approvano ogni firma): [Rafael Schettino](https://github.com/rafaels-dev)

Ogni modifica al ramo `main` deve superare i test automatici ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) prima di poter essere unita.

Privacy: vedi la sezione [Privacy](#privacy). Questo programma non trasferirà alcuna informazione ad altri sistemi in rete, a meno che non sia richiesto espressamente dall'utente o dalla persona che lo installa o lo gestisce, salvo nei casi elencati lì.

## Per gli sviluppatori

Struttura:

- `web/`: l'app (Next.js). Schermate, database SQLite, orchestrazione dei passaggi e chiamate a OpenRouter. Le traduzioni sono in `web/messages/<language>.json` (next-intl) e i prompt di visione in `web/src/lib/prompts.ts`.
- `worker/`: Python. Rilevamento e tracciamento (`detect.py`), video finale (`render.py`), lettura dei video con FFmpeg/NVDEC (`reader.py`).
- `desktop/`: Electron e programmi di installazione (electron-builder). Vedi [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py`: il contatore originale da riga di comando (conteggio automatico su una linea verticale, senza revisione), mantenuto per l'elaborazione in batch e in tempo reale.
- `evaluation/`: strumenti per valutare il conteggio e calibrare i modelli.
- `tests/`, `web/src/**/*.test.ts` e `web/evals/`: test automatici e valutazioni dei prompt.

Per eseguire l'app in sviluppo servono Python 3.11 con le dipendenze e Node.js 22+:

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # oppure cu126 per NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Test (gli stessi della CI, obbligatori per unire in `main`):

```bash
python -m pytest                      # worker e contatore (nella radice)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # prompt di visione in ogni lingua (a pagamento; vedi web/evals/README.md)
```

Aggiungere una lingua: aggiungi un `web/messages/<code>.json` con tutte le chiavi di `en.json`, una voce in `web/src/i18n/locales.ts` e il prompt in `web/src/lib/prompts.ts`. Poi esegui le valutazioni dei prompt.

Contatore da riga di comando:

```bash
python process_video.py --video camera.mp4                 # video annotato + result.json
python process_video.py --video camera.mp4 --no-video      # solo i numeri
python stream_realtime.py rtsp://192.168.1.100/cam4         # eventi JSON in tempo reale
```

## Licenza

Copyright © 2026 Rafael Schettino.

Questo programma è software libero, distribuito sotto la **GNU Affero General Public License, versione 3** ([`LICENSE`](LICENSE)). Puoi usarlo, studiarlo, modificarlo e ridistribuirlo. Se distribuisci versioni modificate, o le offri ad altre persone attraverso una rete, devi rendere disponibile il codice sorgente con la stessa licenza.

Principali componenti di terze parti, tutti open source:

| Componente | Licenza |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) e i pesi `yolov8n.pt` (compreso il fine-tuning in `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (tramite imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |
