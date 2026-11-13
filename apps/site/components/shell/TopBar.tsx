import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { BagButton } from "../bag/BagButton";
import { LanguageSwitch } from "../LanguageSwitch";
import { PageLink } from "../PageLink";
import { Logo } from "./Logo";
import { AgentLogos, ExtensionLogos } from "./Logos";
import { MenuButton } from "./Menu";
import { Soon } from "./Soon";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Верхняя полоса по макету (Figma «Iconavo — Макеты», кадр Header): слева расширения, «For AI agents» и
 * тема, справа поиск, сумка, язык и аккаунт. Расширений, агентов и аккаунта в продукте пока нет — «Soon».
 * На телефоне — кнопка меню, логотип, тема, сумка и аккаунт (класс topbar-wide прячет остальное).
 */
export function TopBar({
  lang,
  languageSwitch = true,
}: {
  lang: Lang;
  languageSwitch?: boolean;
}) {
  const t = DICTIONARIES[lang];
  return (
    <header className="topbar">
      <div className="topbar-group">
        <MenuButton lang={lang} />
        <PageLink lang={lang} path="/" className="topbar-brand">
          <Logo />
          <span className="sr-only">Iconavo</span>
        </PageLink>
        <Soon lang={lang} className="pill topbar-wide">
          <ExtensionLogos />
          <span>{t.extensions}</span>
          <Icon
            icon="material-symbols:keyboard-arrow-down"
            className="pill-chevron"
          />
        </Soon>
        <span className="topbar-divider topbar-wide" aria-hidden="true" />
        <Soon lang={lang} className="pill topbar-wide">
          <span>{t.forAiAgents}</span>
          <AgentLogos />
        </Soon>
        <span className="topbar-divider topbar-wide" aria-hidden="true" />
        <ThemeToggle lang={lang} />
      </div>
      <div className="topbar-group">
        <PageLink lang={lang} path="/search" className="pill topbar-wide">
          <Icon icon="material-symbols:search" className="pill-chevron" />
          <span>{t.topSearch}</span>
        </PageLink>
        <span className="topbar-divider topbar-wide" aria-hidden="true" />
        <BagButton lang={lang} variant="pill" />
        <span className="topbar-divider topbar-wide" aria-hidden="true" />
        {languageSwitch ? (
          <LanguageSwitch variant="flag" className="top-circle topbar-wide" />
        ) : null}
        <Soon lang={lang} className="topbar-account" label={t.account}>
          <span className="top-circle">
            <Icon icon="material-symbols:account-circle" />
          </span>
          <Icon
            icon="material-symbols:keyboard-arrow-down"
            className="topbar-wide topbar-account-chevron"
          />
        </Soon>
      </div>
    </header>
  );
}
