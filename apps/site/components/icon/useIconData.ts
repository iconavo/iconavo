import { type IconData, iconData } from "@iconavo-ui/core/internal";
import { loadIcons } from "@iconavo-ui/react";
import { useEffect, useState } from "react";
import { splitName } from "../../lib/code";
// Хосты иконок — для ядра браузера (lib/iconavo.ts).
import "../../lib/iconavo";

/**
 * Рисунок иконки для кода SVG и файлов (шаг 5 фазы 4): loadIcons ядра — в панели иконка уже в
 * хранилище ядра, на странице это одна пачка edge API. Нет иконки или рисунок не читается — null.
 */
export async function iconDataOf(name: string): Promise<IconData | null> {
  const [prefix, bare] = splitName(name);
  const sets = await loadIcons([name]);
  const set = sets.find((s) => s.prefix === prefix);
  try {
    return set === undefined ? null : iconData(set, bare);
  } catch {
    return null;
  }
}

/** Рисунок, когда он нужен (enabled): до ответа — undefined. */
export function useIconData(
  name: string,
  enabled: boolean,
): IconData | null | undefined {
  const [state, setState] = useState<{ name: string; icon: IconData | null }>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    iconDataOf(name).then(
      (icon) => {
        if (live) setState({ name, icon });
      },
      () => {
        if (live) setState({ name, icon: null });
      },
    );
    return () => {
      live = false;
    };
  }, [name, enabled]);
  return state?.name === name ? state.icon : undefined;
}
