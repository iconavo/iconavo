"use client";

import { Icon } from "@iconavo-ui/react";
import { useSyncExternalStore } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { setCollapsed } from "../../lib/sidebar";

const listeners = new Set<() => void>();
const collapsedNow = () =>
  document.documentElement.dataset.sidebar === "collapsed";

/** Кнопка «свернуть / развернуть» боковую панель на компьютере (макет «Sidebar Collapsed»). */
export function SidebarToggle({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const collapsed = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    collapsedNow,
    () => false,
  );
  return (
    <button
      type="button"
      className="sidebar-toggle"
      aria-label={collapsed ? t.sidebarExpand : t.sidebarCollapse}
      aria-expanded={!collapsed}
      aria-controls="sidebar"
      onClick={() => {
        setCollapsed(!collapsedNow());
        for (const listener of listeners) listener();
      }}
    >
      <Icon
        icon={
          collapsed
            ? "material-symbols:arrow-menu-open"
            : "material-symbols:arrow-menu-close"
        }
      />
    </button>
  );
}
