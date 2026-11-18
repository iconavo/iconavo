import { type IconData, iconData } from "@iconavo-ui/core/internal";
import { type IconavoIconSet, loadIcons } from "@iconavo-ui/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { splitName } from "../../lib/code";
import { knownIconData } from "../../lib/icon-data";
// Хосты иконок — для ядра браузера (lib/iconavo.ts).
import "../../lib/iconavo";

const NO_SETS: readonly IconavoIconSet[] = [];

/**
 * Иконки страницы из серверного HTML (components/PageIcons.tsx). IconavoProvider в ядро их не пишет
 * (ADR-0033), и рисунок карточки первой страницы сетки панель раньше спрашивала у edge API заново — код и
 * толщина линии появлялись в панели позже остального (18 ноября 2026).
 */
export const PageIconSets = createContext<readonly IconavoIconSet[]>(NO_SETS);

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

/**
 * Рисунок, когда он нужен (enabled). Он уже есть в браузере (lib/icon-data.ts) — сразу, в той же
 * отрисовке; иначе запрос, до ответа — undefined.
 */
export function useIconData(
  name: string,
  enabled: boolean,
): IconData | null | undefined {
  const sets = useContext(PageIconSets);
  const known = useMemo(
    () => (enabled ? knownIconData(name, sets) : undefined),
    [name, enabled, sets],
  );
  const [state, setState] = useState<{ name: string; icon: IconData | null }>();
  useEffect(() => {
    if (!enabled || known !== undefined) return;
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
  }, [name, enabled, known]);
  return known ?? (state?.name === name ? state.icon : undefined);
}
