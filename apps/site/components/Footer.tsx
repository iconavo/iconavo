import { DICTIONARIES, type Lang } from "../lib/i18n";
import { PageLink } from "./PageLink";

export function Footer({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <footer className="site-footer">
      <div className="container">
        <p>
          {t.footerCode}{" "}
          <a href="https://github.com/iconavo/iconavo/blob/main/LICENSE">MIT</a>
          . {t.footerIcons}{" "}
          <a href="https://github.com/iconavo/iconavo">GitHub</a>
        </p>
        <p className="footer-links">
          <PageLink lang={lang} path="/changelog">
            {t.footerNews}
          </PageLink>
          <PageLink lang={lang} path="/licenses">
            {t.footerLicenses}
          </PageLink>
        </p>
      </div>
    </footer>
  );
}
