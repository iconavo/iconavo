import { Icon } from "@iconavo-ui/react";
import { getSets } from "../../lib/catalog";
import { countOf, FAMILY_FORMS, ICON_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { Soon } from "../shell/Soon";

/**
 * Начало главной по макету: заголовок, подзаголовок с настоящими числами каталога (без «460,000+» и «drawn
 * in-house» из макета: иконки не наши) и ссылки на расширения и GitHub. Расширений пока нет — «Soon».
 */
export async function HomeIntro({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = Object.values(await getSets());
  const icons = sets.reduce((sum, s) => sum + s.total, 0);
  const subtitle = t.homeSubtitle
    .replace("{icons}", countOf(lang, icons, ICON_FORMS[lang]))
    .replace("{families}", countOf(lang, sets.length, FAMILY_FORMS[lang]));
  return (
    <div className="hero-intro">
      <div className="hero-text">
        <h1 className="hero-title">{t.homeTitle}</h1>
        <p className="hero-subtitle">{subtitle}</p>
      </div>
      <div className="hero-links">
        <Soon lang={lang} className="hero-link">
          <Icon icon="tabler:brand-figma" className="pill-icon" />
          <span>{t.figmaPlugin}</span>
        </Soon>
        <Soon lang={lang} className="hero-link">
          <Icon icon="tabler:brand-vscode" className="pill-icon" />
          <span>{t.vscodeExtension}</span>
        </Soon>
        <a href="https://github.com/iconavo/iconavo" className="hero-link">
          <Icon icon="tabler:brand-github" className="pill-icon" />
          <span>GitHub</span>
        </a>
      </div>
    </div>
  );
}
