// Публичное API ядра — ровно то, что описано в README пакета (packages/icon/README.md, ADR-0029,
// ADR-0030). Вспомогательное для адаптеров и edge API — во внутреннем входе @iconavo-ui/core/internal.
// Описания функций — по-английски: их видят разработчики в подсказках редактора.

import type { IconavoIconSet } from "./icon.js";
import { loadIcon } from "./load.js";
import { isValidNamePart } from "./name.js";
import {
  addSet,
  getIcon,
  type Loader,
  type Settings,
  store,
  subscribeIcon,
  upsert,
} from "./store.js";

export type { IconavoAlias, IconavoIcon, IconavoIconSet } from "./icon.js";

const PLACEHOLDERS = ["skeleton", "spinner", "none"];

const host = (url: string) => url.replace(/\/+$/, "");

function checkPrefix(prefix: string): void {
  if (!isValidNamePart(prefix)) {
    throw new Error(`Invalid icon set prefix "${prefix}"`);
  }
}

/**
 * Sets the hosts and defaults for the whole page. A list replaces the default one, `[]` turns that
 * kind of host off, and options you leave out keep their values. Call it before the first icon renders.
 */
export function configure(options: Partial<Settings>): void {
  const settings = store.settings;
  if (options.api) settings.api = options.api.map(host);
  if (options.cdn) settings.cdn = options.cdn.map(host);
  if (PLACEHOLDERS.includes(options.placeholder as string)) {
    settings.placeholder = options.placeholder as Settings["placeholder"];
  }
  if (typeof options.dev === "boolean") settings.dev = options.dev;
}

/**
 * Adds icons in IconifyJSON format, one icon set per object. Added icons are never requested from
 * the network; they replace icons with the same names, and icons already on the page redraw.
 */
export function addIcons(data: IconavoIconSet | IconavoIconSet[]): void {
  const sets = Array.isArray(data) ? data : [data];
  for (const set of sets) checkPrefix(set.prefix);
  for (const set of sets) addSet(set.prefix, set, true);
}

/**
 * Loads one icon set from your own source instead of the hosts. `null` instead of a function
 * removes the loader.
 */
export function setLoader(prefix: string, loader: Loader | null): void {
  checkPrefix(prefix);
  if (loader) store.loaders.set(prefix, loader);
  else store.loaders.delete(prefix);
}

/**
 * Loads icons ahead of time. Resolves with one IconifyJSON object per icon set: the loaded icons and,
 * in `not_found`, the missing names. Never rejects: icons that failed to load are left out.
 */
export function loadIcons(names: string[]): Promise<IconavoIconSet[]> {
  const unique = [...new Set(names)];
  return new Promise((resolve) => {
    const stops: (() => void)[] = [];
    const check = () => {
      if (unique.some((name) => getIcon(name) === "loading")) return;
      for (const stop of stops) stop();
      resolve(collect(unique));
    };
    for (const name of unique) {
      stops.push(subscribeIcon(name, check));
      loadIcon(name);
    }
    check();
  });
}

/**
 * Ответ loadIcons: по объекту на набор в порядке первого упоминания, копии данных хранилища.
 * «Ошибка» не попадает; имя без верного набора — тоже: его некуда положить.
 */
function collect(names: string[]): IconavoIconSet[] {
  const sets = new Map<string, IconavoIconSet>();
  for (const name of names) {
    const state = getIcon(name);
    const parts = String(name).split(":");
    const [prefix, icon] = parts as [string, string];
    if (state === "error" || parts.length !== 2 || !isValidNamePart(prefix)) {
      continue;
    }
    const set = upsert(sets, prefix, () => ({ prefix, icons: {} }));
    if (typeof state === "object") {
      set.icons[icon] = { ...state };
    } else {
      set.not_found ??= [];
      set.not_found.push(icon);
    }
  }
  return [...sets.values()];
}
