"use client";

import { Icon } from "@iconavo-ui/react";
import {
  openAuth,
  useAccountsEnabled,
  useSession,
  wasSignedIn,
} from "../../lib/account";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { Soon } from "../shell/Soon";
import { AccountMenu } from "./AccountMenu";
import { LOG_IN_BUTTON_ID } from "./ids";
import { preloadAuthDialog } from "./load";

/**
 * Аккаунт в верхней полосе (кадры «Log In / Start Point» и «Log In / Logged In»): гостю — «Log In»,
 * вошедшему — аватар с меню. В закрытом режиме, на сервере и при гидратации — «Soon», как раньше
 * (решение владельца 27 ноября 2026). Пока узнаём, кто вошёл (здесь входили), — пустой круг аватара:
 * «Log In» не мелькает у тех, кто уже вошёл.
 */
export function AccountEntry({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const enabled = useAccountsEnabled();
  const session = useSession();
  if (!enabled) {
    return (
      <Soon lang={lang} className="topbar-account" label={t.account}>
        <span className="top-circle">
          <Icon icon="material-symbols:account-circle" />
        </span>
        <Icon
          icon="material-symbols:keyboard-arrow-down"
          className="topbar-wide topbar-account-chevron"
        />
      </Soon>
    );
  }
  if (session.status === "signed-in") {
    return <AccountMenu lang={lang} user={session.user} />;
  }
  if (session.status === "unknown" && wasSignedIn()) {
    return (
      <span className="topbar-account" aria-hidden="true">
        <span className="top-circle account-avatar" />
      </span>
    );
  }
  return (
    <button
      type="button"
      id={LOG_IN_BUTTON_ID}
      className="account-log-in"
      aria-haspopup="dialog"
      onPointerEnter={preloadAuthDialog}
      onFocus={preloadAuthDialog}
      onClick={(e) => openAuth("login", { opener: e.currentTarget })}
    >
      {t.topLogIn}
    </button>
  );
}
