import { CONTRIBUTORS } from "@/lib/contributors";
import { CREDITS } from "@/lib/credits";
import type { Release } from "@/lib/release";
import { DONATE, LINKS, type Locale, type Messages, pagePath } from "@/lib/site";
import { Footer, Nav } from "./Chrome";
import { Download } from "./Download";

type Props = { locale: Locale; t: Messages };

/** Every installer, the visitor's own system first. */
export function DownloadPage({ locale, t, release }: Props & { release: Release }) {
  return (
    <>
      <Nav locale={locale} t={t} page="download" />
      <main id="main" className="sub">
        <div className="container sub__grid">
          <div className="hero__text">
            <h1>{t.download.title}</h1>
            <p className="lead">{t.download.lead}</p>
          </div>
          <Download locale={locale} t={t.download} initial={release} />
          <ul className="notes">
            <li>{t.download.firstRun}</li>
            <li>
              <a href={LINKS.releases}>{t.download.older}</a>
            </li>
            <li>
              <a href={pagePath(locale, "credits")}>{t.footer.credits}</a>
            </li>
          </ul>
        </div>
      </main>
      <Footer locale={locale} t={t} page="download" />
    </>
  );
}

/** Who builds the project: a photo or logo, the name, the role and the group. */
export function ContributorsPage({ locale, t }: Props) {
  return (
    <>
      <Nav locale={locale} t={t} page="contributors" />
      <main id="main" className="sub">
        <div className="container sub__grid">
          <div className="hero__text">
            <h1>{t.contributors.title}</h1>
            <p className="lead">{t.contributors.lead}</p>
          </div>
          <ul className="people">
            {CONTRIBUTORS.map((person) => (
              <li className="person" key={person.name}>
                {person.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="person__face" src={person.image} width={400} height={400} alt={t.contributors.portrait.replace("{name}", person.name)} />
                ) : (
                  <span className="person__face on-ink" aria-hidden="true">
                    {person.name.split(" ").map((word) => word[0]).join("")}
                  </span>
                )}
                <h2>{person.url ? <a href={person.url}>{person.name}</a> : person.name}</h2>
                <p>
                  {person.role && `${t.contributors.roles[person.role]}, `}
                  {person.orgUrl ? <a href={person.orgUrl}>{person.org}</a> : person.org}
                </p>
              </li>
            ))}
          </ul>
          <ul className="notes">
            <li>{t.contributors.join}</li>
            <li>
              <a href={`${pagePath(locale, "")}#contribute`}>{t.contributors.joinLink}</a>
            </li>
          </ul>
        </div>
      </main>
      <Footer locale={locale} t={t} page="contributors" />
    </>
  );
}

/** The licence in plain words and the projects the app stands on. */
export function CreditsPage({ locale, t }: Props) {
  return (
    <>
      <Nav locale={locale} t={t} page="credits" />
      <main id="main" className="sub">
        <div className="container sub__grid">
          <div className="hero__text">
            <h1>{t.credits.title}</h1>
            <p className="lead">{t.credits.lead}</p>
          </div>
          <section className="licence plate on-ink">
            <h2>{t.credits.licenceTitle}</h2>
            <p>{t.credits.copyright}</p>
            <p>{t.credits.licenceText}</p>
            <a className="btn" href={LINKS.licence}>{t.credits.licenceLink}</a>
          </section>
          <h2 id="built-with">{t.credits.creditsTitle}</h2>
          <table className="list list--tall" aria-labelledby="built-with">
            <thead>
              <tr>
                <th scope="col">{t.credits.cols.project}</th>
                <th scope="col">{t.credits.cols.role}</th>
                <th scope="col">{t.credits.cols.licence}</th>
              </tr>
            </thead>
            <tbody>
              {CREDITS.map((credit, i) => (
                <tr key={credit.name}>
                  <td className="what"><a href={credit.url}>{credit.name}</a></td>
                  <td>{t.credits.roles[i]}</td>
                  <td>{credit.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="notes">
            <li>{t.credits.weights}</li>
          </ul>
        </div>
      </main>
      <Footer locale={locale} t={t} page="credits" />
    </>
  );
}

/** What a donation pays for and where to give. */
export function DonatePage({ locale, t }: Props) {
  return (
    <>
      <Nav locale={locale} t={t} page="donate" />
      <main id="main" className="sub">
        <div className="container sub__grid">
          <div className="hero__text">
            <h1>{t.donate.title}</h1>
            <p className="lead">{t.donate.lead}</p>
          </div>
          <div className="plate on-ink get">
            {DONATE.length === 0 ? (
              <p>{t.donate.soon}</p>
            ) : (
              DONATE.map((channel, i) => (
                <a key={channel.url} className={i === 0 ? "btn btn--primary" : "btn"} href={channel.url}>
                  {t.donate.give.replace("{channel}", channel.name)}
                </a>
              ))
            )}
          </div>
          <ul className="rows uses">
            {t.donate.uses.map((use) => (
              <li className="row" key={use.title}>
                <h2>{use.title}</h2>
                <p>{use.text}</p>
              </li>
            ))}
          </ul>
          <ul className="notes">
            <li>
              <a href={`${pagePath(locale, "")}#contribute`}>{t.donate.other}</a>
            </li>
          </ul>
        </div>
      </main>
      <Footer locale={locale} t={t} page="donate" />
    </>
  );
}
