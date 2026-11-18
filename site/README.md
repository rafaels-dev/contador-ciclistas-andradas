# counter.bike — site

The project's public site: a static Next.js export, designed with the
[Hallmark](https://github.com/Nutlope/hallmark) skill (theme Wayfind).

```bash
npm install
npm run dev        # http://127.0.0.1:3100
npm run build      # static files in out/
npm run typecheck
```

## Languages

The same eight as the app (`lib/site.ts` → `LOCALES`). Portuguese, the default
(`DEFAULT_LOCALE`), is served at `/`,
the others at `/<code>/` in lowercase (`/en/`, `/es/`…). Texts live in
`messages/<code>.json`, all with the same keys as `en.json`. A first-time visitor
on `/` whose browser prefers another supported language is sent to it once; the
language picked in the menu is remembered (`localStorage` `cb:language`).

Adding a language: add it to `LOCALES` and `LOCALE_NAMES`, then create
`messages/<code>.json`.

## Pages

Besides the home page, every language has `/download/`, `/contributors/`,
`/credits/` and `/donate/` (`PAGES` in `lib/site.ts`, bodies in `components/Subpages.tsx`).

- **Download** (`lib/release.ts`, `components/Download.tsx`): offers the
  visitor's own system first and lists every installer. The links are the
  release files themselves, so a click downloads without opening GitHub. The
  latest release is read from the GitHub API at build time and again in the
  browser; the constant `FALLBACK` is used when GitHub cannot be reached.
- **Credits** (`lib/credits.ts`): the licence in plain words and the open-source
  projects the app is built on. A new dependency that ships with the app gets a
  row there and a line in `credits.roles` of every `messages/*.json`.
- **Contributors** (`lib/contributors.ts`): one card per person or group, with a
  square photo or logo from `public/people/` (the initials when there is none).
- **Donate**: the channels are the `DONATE` list in `lib/site.ts`. While it is
  empty the page says donations are not open yet.

## Pictures

Everything in `public/shots/` is a real capture of the app or a frame of a final
video it rendered. The screens and the video frames exist once per language, in
`public/shots/<code in lowercase>/`, taken with the app set to that language;
`components/Shot.tsx` maps each one to its place on the page.

## Deploy (Vercel)

Project `counter-bike` on Vercel, linked to this repository with root directory
`site`; a push to `main` publishes. The domain's DNS is at Cloudflare (two `A`
records and the `www` CNAME, not proxied). `vercel.json` sends the old `/pt-br/`
addresses to the root.

## Design system

`styles/tokens.css` and `styles/base.css` come from the Hallmark scaffold;
`styles/site.css` starts with the Hallmark stamp (do not move it) and holds the
page. Check a change with:

```bash
node ../.claude/skills/hallmark/scripts/sloplint.mjs styles --genre modern-minimal --render --url http://127.0.0.1:3100/
```

(the render tier needs `puppeteer-core`; point `HALLMARK_PUPPETEER` at a folder that has it).
