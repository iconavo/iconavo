"use client";
// Обёртка IconavoProvider (ADR-0033): иконки, загруженные на сервере, — для серверного HTML и для
// гидратации. Серверный компонент вызывает await loadIcons([...]) и передаёт ответ сюда; данные
// приходят в браузер вместе со страницей.
// - Иконка ищется лениво — по префиксу, через iconData ядра, с алиасами и поворотами в данных; сломанная
//   цепочка — «нет», как в хранилище. Найденное кэшируется по имени: useSyncExternalStore нужен тот же
//   объект при повторе.
// - Вложенная обёртка сначала ищет у себя, потом у внешних; свой not_found не заслоняет иконку внешней.
// - Ядро обёртка не трогает: на сервере его память общая для всех запросов, а запись во время
//   отрисовки в браузере разбудила бы чужие иконки посреди отрисовки этой.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { iconData } from "@iconavo-ui/core/internal";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import type { Provided } from "./state.js";

interface Scope {
  /** Наборы обёртки по префиксу. */
  sets: Map<string, IconavoIconSet[]>;
  parent: Scope | null;
  /** Имя → иконка или «нет» в этой обёртке; null — имени в её данных нет. */
  found: Map<string, Exclude<Provided, undefined> | null>;
}

export const Icons = createContext<Scope | null>(null);

/** Имя в данных одной обёртки. */
function own(scope: Scope, name: string): Exclude<Provided, undefined> | null {
  let found = scope.found.get(name);
  if (found === undefined) {
    found = null;
    const [prefix, icon] = name.split(":") as [string, string];
    for (const set of scope.sets.get(prefix) ?? []) {
      try {
        const data = iconData(set, icon);
        if (typeof data?.body === "string") {
          found = data;
          break;
        }
      } catch {
        found = "missing";
      }
      if (set.not_found?.includes(icon)) found = "missing";
    }
    scope.found.set(name, found);
  }
  return found;
}

/** Имя (верное) в обёртках: иконка ближней из них, иначе «нет», если его не нашла хоть одна. */
export function lookup(scope: Scope | null, name: string): Provided {
  let missing = false;
  for (let s = scope; s; s = s.parent) {
    const found = own(s, name);
    if (typeof found === "object" && found !== null) return found;
    if (found === "missing") missing = true;
  }
  return missing ? "missing" : undefined;
}

/**
 * Passes icons loaded on the server (`IconavoIconSet[]`, as returned by `loadIcons`) to the
 * components inside, for the server HTML and for hydration.
 */
export function IconavoProvider({
  icons,
  children,
}: {
  icons: IconavoIconSet[];
  children?: ReactNode;
}) {
  const parent = useContext(Icons);
  // Набор с неверным префиксом не найдётся никогда: имена проверены до поиска.
  const value = useMemo(() => {
    const sets = new Map<string, IconavoIconSet[]>();
    for (const set of icons ?? []) {
      const list = sets.get(set.prefix) ?? [];
      list.push(set);
      sets.set(set.prefix, list);
    }
    return { sets, parent, found: new Map() };
  }, [icons, parent]);
  return createElement(Icons.Provider, { value }, children);
}
