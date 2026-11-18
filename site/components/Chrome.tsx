import { LINKS, LOCALES, LOCALE_NAMES, type Locale, type Messages, type PageSlug, pagePath } from "@/lib/site";

type Props = { locale: Locale; t: Messages; page: PageSlug };

/** Month the site was last signed, shown in the letter close. */
const SIGNED = new Date(Date.UTC(2026, 10, 17));

/** The floating bar. On a sub-page the section links lead back to the home page. */
export function Nav({ locale, t, page }: Props) {
  const home = page ? pagePath(locale, "") : "";
  return (
    <>
      <a className="skip" href="#main">{t.nav.skip}</a>
      <header className="nav container">
        <nav className="nav__bar on-ink" aria-label="counter.bike">
          <a className="nav__mark" href={pagePath(locale, "")} aria-label={t.nav.home}>counter.bike</a>
          <ul className="nav__links">
            <li><a href={`${home}#route`}>{t.nav.route}</a></li>
            <li><a href={`${home}#checked`}>{t.nav.checked}</a></li>
            <li><a href={`${home}#contribute`}>{t.nav.contribute}</a></li>
            <li><a href={LINKS.repo}>{t.nav.source}</a></li>
            <li><a href={pagePath(locale, "donate")} aria-current={page === "donate" ? "page" : undefined}>{t.nav.donate}</a></li>
          </ul>
          <details className="lang">
            <summary aria-label={`${t.nav.language}: ${LOCALE_NAMES[locale]}`}>{LOCALE_NAMES[locale]}</summary>
            <ul>
              {LOCALES.map((l) => (
                <li key={l}>
                  <a href={pagePath(l, page)} hrefLang={l} lang={l} data-language={l.toLowerCase()} aria-current={l === locale ? "true" : undefined}>
                    {LOCALE_NAMES[l]}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <a className="btn" href={pagePath(locale, "download")} aria-current={page === "download" ? "page" : undefined}>{t.nav.download}</a>
        </nav>
      </header>
    </>
  );
}

/** The letter close: a sign-off, who signs, the site's own pages and the languages. */
export function Footer({ locale, t, page }: Props) {
  const signed = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(SIGNED);
  return (
    <footer className="foot">
      <div className="container foot__grid">
        <div>
          <p className="foot__signoff">{t.footer.signoff}</p>
          <p className="foot__signature">
            {t.footer.signature}, <time dateTime="2026-11">{signed}</time>
          </p>
        </div>
        <div className="foot__links">
          <ul>
            <li><a href={pagePath(locale, "download")}>{t.nav.download}</a></li>
            <li><a href={pagePath(locale, "donate")}>{t.nav.donate}</a></li>
            <li><a href={pagePath(locale, "credits")}>{t.footer.credits}</a></li>
            <li><a href={LINKS.repo}>{t.footer.source}</a></li>
          </ul>
          <ul aria-label={t.footer.languages}>
            {LOCALES.map((l) => (
              <li key={l}>
                <a href={pagePath(l, page)} hrefLang={l} lang={l} data-language={l.toLowerCase()}>{LOCALE_NAMES[l]}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
