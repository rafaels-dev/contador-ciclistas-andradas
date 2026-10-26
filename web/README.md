# web — review app (Next.js)

A job's flow (fixed order):

1. **downloading** — the video from the Google Drive link (public), or a file on this computer used in place
2. **awaiting_lines** — the user draws one or more counting lines (any angle) over the first frame; they can be saved per camera
3. **detecting** — the Python worker (`../worker/detect.py`) creates one candidate per trajectory that crosses each line (no lines: every trajectory with a relevant displacement)
4. **suggesting** — OpenRouter suggests the category for **every** candidate, with the prompt in the app language (`src/lib/prompts.ts`)
5. **awaiting_review** — a person confirms, corrects or discards each candidate
6. The final video is a separate *render* (`/renders`): one or more reviewed jobs, only with the confirmed events

```bash
npm install
npm run dev          # development (hot reload), http://127.0.0.1:3000
npm run production   # production mode with the same data (builds in a clean copy and starts on 3000)
npm test             # Vitest (lib, i18n, legacy data migration)
npm run eval:prompts # promptfoo: the vision prompt in every language (paid; see evals/README.md)
```

`OPENROUTER_API_KEY` comes from the `.env` at the repository root (loaded in `next.config.ts`).
SQLite database (`node:sqlite`, Node ≥ 22.13) and job files in `web/data/` (gitignored).

## Languages

next-intl without a locale in the URL: the language is a preference (`settings.language`; absent or `system` = the computer's — from Electron's `TRAFFIC_COUNTER_SYSTEM_LOCALES` or the browser's `Accept-Language`), resolved in `src/i18n/request.ts`. Messages in `messages/<code>.json`; `src/i18n/i18n.test.ts` checks that every language has the same keys and ICU arguments as `en.json`.

Texts written to the database by background work (progress, errors) are stored as translatable messages (`msg()` in `src/i18n/message.ts`) and translated on screen with `formatStored`, so they follow the language at the time they are read.
