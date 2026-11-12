import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import { BagMenu } from "./BagMenu";
import { LanguageSwitch } from "./LanguageSwitch";
import { PageLink } from "./PageLink";
import { Soon } from "./shell/Soon";

/**
 * Подвал по макету (Figma «Iconavo — Макеты»): слева расширения, GitHub и «For AI agents», справа
 * документация, инструменты, конфиденциальность, язык и сумка. Лента выпусков и лицензии остаются: там
 * тексты лицензий наборов, без них нельзя (ADR-0017). Чего в продукте нет — «Soon».
 */
export function Footer({
  lang,
  languageSwitch = true,
}: {
  lang: Lang;
  languageSwitch?: boolean;
}) {
  const t = DICTIONARIES[lang];
  return (
    <footer className="site-footer">
      <div className="footer-group">
        <Soon lang={lang} className="footer-link" above>
          <Icon icon="tabler:brand-figma" className="pill-icon" />
          <span>{t.figmaPlugin}</span>
        </Soon>
        <Soon lang={lang} className="footer-link" above>
          <Icon icon="tabler:brand-vscode" className="pill-icon" />
          <span>{t.vscodeExtension}</span>
        </Soon>
        <a href="https://github.com/iconavo/iconavo" className="footer-link">
          <Icon icon="tabler:brand-github" className="pill-icon" />
          <span>GitHub</span>
        </a>
        <Soon lang={lang} className="footer-link" above>
          <span>{t.forAiAgents}</span>
          <Icon icon="lucide:bot" className="pill-icon" />
          <Icon icon="lucide:sparkles" className="pill-icon" />
        </Soon>
      </div>
      <div className="footer-group">
        <PageLink lang={lang} path="/changelog" className="footer-text">
          {t.footerNews}
        </PageLink>
        <PageLink lang={lang} path="/licenses" className="footer-text">
          {t.footerLicenses}
        </PageLink>
        <PageLink lang={lang} path="/docs" className="footer-text">
          {t.docs}
        </PageLink>
        <Soon lang={lang} className="footer-text" above>
          {t.navTools}
        </Soon>
        <Soon lang={lang} className="footer-text" above>
          {t.privacy}
        </Soon>
        <span className="topbar-divider" aria-hidden="true" />
        {languageSwitch ? (
          <LanguageSwitch variant="code" className="top-circle" />
        ) : null}
        <BagMenu lang={lang} variant="icon" />
      </div>
    </footer>
  );
}
