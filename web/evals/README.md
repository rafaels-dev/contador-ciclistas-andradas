# Prompt evals

The vision model prompt (`src/lib/prompts.ts`) exists in every app language, and so do the category words the model answers with. These evals use [promptfoo](https://promptfoo.dev) to check that each language still classifies like the others. Every labeled candidate is classified once per language, through the same `suggestCategory` call the app makes, and compared with the human label.

## Data

The images show people on the street, so they are **not** in the repository. You need one or more folders, each with:

```
calibration.json        [{id, label, filmstrip, context, hour}]  (calibracao.json from before 0.0.8 also works)
filmstrips/<id>.jpg
contexts/<id>.jpg       (or contextos/)
```

`evaluation/build_llm_calibration.py` builds these folders from labeled videos. The audited night set (142 cases) is in `evaluation/llm_calibration_audited.json`; its images are on the project Drive.

## Running

From `web/`, with the OpenRouter key in `OPENROUTER_API_KEY` or saved in the app's Settings (the provider reads it from there and never prints it):

```bash
EVAL_DATA="/path/night;/path/day" npm run eval:prompts            # 6 cases per category per folder
EVAL_DATA=/path/night EVAL_SAMPLE=all npm run eval:prompts         # every case
npx -y -p node@24.11.0 -p promptfoo@0.124.1 -- promptfoo view   # results table in the browser
```

promptfoo needs Node 22.22+; the script fetches Node 24 just for itself (`npx -p node@24.11.0`), so the project Node does not have to change. On Windows PowerShell, set the variables first: `$env:EVAL_DATA="C:\calib\night;C:\calib\day"`.

**Cost:** with Claude Haiku 5.5, about US$ 0.25 per thousand classifications (the prompts in other languages are a little longer). The default sample (2 folders, 41 cases, 8 languages = 328 calls) cost US$ 0.08. Running every case of both sets (~1,400 calls) costs about US$ 0.35.

**What to expect:** at the last calibration (Oct/2026), Haiku 5.5 got 99–100% right in Portuguese. First run of these evals (Oct/2026, 41 night and day cases × 8 languages): 328 of 328 right. Every language should stay at 95% or above. A language well below the others usually means a category word or description that the model reads differently. Compare the answers in `promptfoo view`; each answer's `reason` explains it in that language.

Run the evals before and after any change to `prompts.ts`.
