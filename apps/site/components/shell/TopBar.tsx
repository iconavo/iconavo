import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { AccountEntry } from "../account/AccountEntry";
import { BagButton } from "../bag/BagButton";
import { LanguageSwitch } from "../LanguageSwitch";
import { PageLink } from "../PageLink";
import { Logo } from "./Logo";
import { AgentLogos, ExtensionLogos } from "./Logos";
import { MenuButton } from "./Menu";
import { SearchPill } from "./SearchPill";
import { Soon } from "./Soon";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Верхняя полоса по макету (Figma «Iconavo — Макеты», кадр Header): слева расширения, «For AI agents» и
 * тема, справа поиск, сумка, язык и аккаунт. Расширений и агентов в продукте пока нет — «Soon»; аккаунт —
 * components/account/AccountEntry.tsx (в закрытом режиме — тоже «Soon»).
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
        <SearchPill lang={lang} />
        <span className="topbar-divider topbar-wide" aria-hidden="true" />
        <BagButton lang={lang} variant="pill" />
        <span className="topbar-divider topbar-wide" aria-hidden="true" />
        {languageSwitch ? (
          <LanguageSwitch variant="flag" className="top-circle topbar-wide" />
        ) : null}
        <AccountEntry lang={lang} />
      </div>
    </header>
  );
}
