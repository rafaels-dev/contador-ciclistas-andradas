import { CHECKED, LINKS, type Locale, type Messages, pagePath } from "@/lib/site";
import { Footer, Nav } from "./Chrome";
import { Route } from "./Route";
import { Shot } from "./Shot";

export function Page({ locale, t }: { locale: Locale; t: Messages }) {
  const number = new Intl.NumberFormat(locale);
  const download = pagePath(locale, "download");
  /** Where each way to help sends the visitor, in the order of `contribute.rows`. */
  const helpLinks = [LINKS.issues, LINKS.issues, LINKS.languages, download];

  return (
    <>
      <Nav locale={locale} t={t} page="" />

      <main id="main">
        <section className="hero">
          <div className="container hero__grid">
            <div className="hero__text">
              <h1>{t.hero.title}</h1>
              <p className="lead">{t.hero.lead}</p>
            </div>
            <div className="plate on-ink">
              <a className="btn btn--primary" href={download}>{t.hero.download}</a>
              <a className="btn" href={LINKS.repo}>{t.hero.source}</a>
              <p className="small">{t.hero.platforms}</p>
            </div>
          </div>
        </section>

        <section className="section section--s" aria-label={t.showcase.caption}>
          <div className="container">
            <Shot locale={locale} name="review" slot="hero" alt={t.showcase.alt} caption={t.showcase.caption} lead />
          </div>
        </section>

        <section className="section" id="route">
          <div className="container">
            <div className="head">
              <h2>{t.route.title}</h2>
              <p className="lead">{t.route.lead}</p>
            </div>
            <Route locale={locale} t={t.route} />
          </div>
        </section>

        <section className="section section--l board on-ink" id="checked">
          <div className="container">
            <div className="head">
              <h2>{t.checked.title}</h2>
              <p className="lead">{t.checked.lead}</p>
            </div>
            <table>
              <caption>{t.checked.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.checked.cols.what}</th>
                  <th scope="col">{t.checked.cols.where}</th>
                  <th scope="col" className="num">{t.checked.cols.hand}</th>
                  <th scope="col" className="num">{t.checked.cols.software}</th>
                </tr>
              </thead>
              <tbody>
                {t.checked.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="what">{row.what}</td>
                    <td className="where">{row.where}</td>
                    <td className="num" data-label={t.checked.cols.hand}>{number.format(CHECKED[i].hand)}</td>
                    <td className="num software" data-label={t.checked.cols.software}>{number.format(CHECKED[i].software)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="board__note">{t.checked.note}</p>
          </div>
        </section>

        <section className="section" id="contribute">
          <div className="container statement">
            <h2>{t.statement.title}</h2>
            <p className="lead">{t.statement.text}</p>
          </div>
          <div className="container help">
            <div className="head">
              <h3>{t.contribute.title}</h3>
              <p className="lead">{t.contribute.lead}</p>
            </div>
            <ul className="rows">
              {t.contribute.rows.map((row, i) => (
                <li className="row" key={row.title}>
                  <h3>{row.title}</h3>
                  <p>{row.text}</p>
                  <a href={helpLinks[i]}>{row.link}</a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section section--l" id="download">
          <div className="container close">
            <div className="close__text">
              <h2>{t.close.title}</h2>
              <dl className="facts">
                {t.close.facts.map((fact) => (
                  <div key={fact.term}>
                    <dt>{fact.term}</dt>
                    <dd>{fact.text}</dd>
                  </div>
                ))}
              </dl>
              <a className="btn" href={download}>{t.close.download}</a>
            </div>
            <Shot locale={locale} name="finalClose" slot="close" alt={t.close.alt} caption={t.close.caption} />
          </div>
        </section>
      </main>

      <Footer locale={locale} t={t} page="" />
    </>
  );
}
