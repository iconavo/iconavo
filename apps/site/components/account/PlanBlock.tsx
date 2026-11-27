"use client";

import { Icon } from "@iconavo-ui/react";
import {
  openAuth,
  useAccountsEnabled,
  useSession,
  wasSignedIn,
} from "../../lib/account";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PlanLogo } from "../shell/Logos";
import { Soon } from "../shell/Soon";
import { Avatar } from "./AccountMenu";
import { preloadAuthDialog } from "./load";

/**
 * Блок «Your Plan» внизу боковой панели (компонент Plan Summary макета). В закрытом режиме, на сервере и при
 * гидратации — «Soon», как раньше. Гостю — «Log In to Your Account»: открывает окно входа. Вошедшему —
 * аватар и имя, пока имени нет — почта, без «Manage»: тарифов до фазы 8 нет (решение владельца
 * 27 ноября 2026). Разметка — та же, что у тарифа: сворачивание панели оставляет только значок.
 */
export function PlanBlock({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const enabled = useAccountsEnabled();
  const session = useSession();
  if (!enabled) {
    return (
      <Soon lang={lang} className="sidebar-plan-button" above>
        <span className="sidebar-plan-info">
          <span className="sidebar-plan-label">{t.planLabel}</span>
          <span className="sidebar-plan-tier">
            <PlanLogo />
            <span className="sidebar-label">{t.planName}</span>
          </span>
        </span>
        <span className="sidebar-plan-manage">{t.planManage}</span>
      </Soon>
    );
  }
  if (session.status === "signed-in") {
    const { user } = session;
    return (
      <div className="sidebar-plan-button account-plan">
        <span className="sidebar-plan-info">
          <span className="sidebar-plan-label">{t.planLoggedInAs}</span>
          <span className="sidebar-plan-tier">
            <Avatar user={user} className="account-plan-avatar" />
            <span className="sidebar-label account-plan-name">
              {user.name || user.email}
            </span>
          </span>
        </span>
      </div>
    );
  }
  const checking = session.status === "unknown" && wasSignedIn();
  return (
    <button
      type="button"
      className="sidebar-plan-button account-plan"
      aria-haspopup="dialog"
      aria-disabled={checking ? "true" : undefined}
      onPointerEnter={preloadAuthDialog}
      onFocus={preloadAuthDialog}
      onClick={(e) => {
        if (!checking) openAuth("login", { opener: e.currentTarget });
      }}
    >
      <span className="sidebar-plan-info">
        <span className="sidebar-plan-label">{t.planLabel}</span>
        <span className="sidebar-plan-tier">
          <span className="account-plan-avatar">
            <Icon icon="material-symbols:account-circle" />
          </span>
          <span className="sidebar-label">{t.planLogIn}</span>
        </span>
      </span>
    </button>
  );
}
