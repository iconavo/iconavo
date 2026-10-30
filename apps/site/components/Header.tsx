import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import { PageLink } from "./PageLink";
import { SearchField } from "./SearchField";
import { ThemeMenu } from "./ThemeMenu";

/**
 * Шапка сайта: имя, поле поиска, ссылки, переключатели языка и темы. Синхронная, без чтения файлов —
 * так её показывает и Storybook. У страницы 404 переключателя языка нет: она одна на все адреса.
 */
export function Header({
  lang,
  languageSwitch = true,
}: {
  lang: Lang;
  languageSwitch?: boolean;
}) {
  const t = DICTIONARIES[lang];
  return (
    <header className="site-header">
      <div className="container header-row">
        <PageLink lang={lang} path="/" className="brand">
          Iconavo
        </PageLink>
        <SearchField lang={lang} />
        <nav aria-label={t.mainNav} className="header-nav">
          <PageLink lang={lang} path="/docs">
            {t.docs}
          </PageLink>
          <a href="https://github.com/iconavo/iconavo">
            <Icon icon="tabler:brand-github" className="inline-block" /> GitHub
          </a>
        </nav>
        <div className="header-tools">
          {languageSwitch ? <LanguageSwitch /> : null}
          <ThemeMenu lang={lang} />
        </div>
      </div>
    </header>
  );
}
