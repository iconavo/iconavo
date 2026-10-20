// Состояние набора для журнала (ADR-0018): иконки с пометкой hidden и алиасы. Из состояния строится
// icons.json в формате IconifyJSON, по нему считается версия набора.

import { createHash } from "node:crypto";
import { iconsFileSchema } from "@iconavo-ui/schema";
import { canonicalJson, type Json } from "../build/json.js";
import type { NormalizedIcon } from "../normalize/normalize.js";

export interface StateIcon {
  icon: NormalizedIcon;
  /** Автор удалил иконку: по имени она работает, в каталоге и поиске её нет (ADR-0005). */
  hidden: boolean;
}

export interface SetState {
  icons: Map<string, StateIcon>;
  /** Алиас → родитель. Родитель — всегда иконка: цепочек нет. */
  aliases: Map<string, string>;
}

/** Шагов по цепочке алиасов, после которых родитель считается ненайденным. */
const CHAIN_LIMIT = 10;

/**
 * Состояние из icons.json. Цепочки алиасов разворачиваются до иконки; алиас без иконки в конце
 * цепочки — ошибка: такой файл наша сборка записать не могла. Повороты и отражения алиасов не
 * переносятся — наши алиасы их не используют.
 */
export function stateOf(data: unknown): SetState {
  const file = iconsFileSchema.parse(data);
  // По умолчанию у IconifyJSON размер 16.
  const width = file.width ?? 16;
  const height = file.height ?? 16;
  const icons = new Map<string, StateIcon>();
  for (const [name, icon] of Object.entries(file.icons)) {
    icons.set(name, {
      icon: {
        body: icon.body,
        width: icon.width ?? width,
        height: icon.height ?? height,
      },
      hidden: icon.hidden === true,
    });
  }
  const aliases = new Map<string, string>();
  const all = file.aliases ?? {};
  for (const name of Object.keys(all)) {
    let parent = name;
    for (
      let step = 0;
      step < CHAIN_LIMIT && Object.hasOwn(all, parent);
      step++
    ) {
      parent = all[parent]?.parent as string;
    }
    if (!icons.has(parent)) {
      throw new Error(`алиас «${name}» не ведёт ни к одной иконке`);
    }
    aliases.set(name, parent);
  }
  return { icons, aliases };
}

/** Иконка, которую показывает имя: своя у иконки, родителя — у алиаса. */
export function resolve(
  state: SetState,
  name: string,
): NormalizedIcon | undefined {
  return state.icons.get(state.aliases.get(name) ?? name)?.icon;
}

/** Все имена набора с картинками: алиас получает картинку родителя. */
export function flatten(state: SetState): Map<string, NormalizedIcon> {
  const out = new Map<string, NormalizedIcon>();
  for (const [name, { icon }] of state.icons) out.set(name, icon);
  for (const [name, parent] of state.aliases) {
    const icon = state.icons.get(parent)?.icon;
    if (icon) out.set(name, icon);
  }
  return out;
}

/**
 * Данные icons.json (IconifyJSON): размер набора общий, у иконки — только если он другой; скрытые —
 * с hidden: true. lastModified — время последнего выпуска в секундах; без него — данные для версии.
 */
export function iconsFileOf(
  prefix: string,
  grid: number,
  state: SetState,
  lastModified?: number,
): { [key: string]: Json } {
  const list: { [key: string]: Json } = {};
  for (const [name, { icon, hidden }] of state.icons) {
    const item: { [key: string]: Json } = { body: icon.body };
    if (icon.width !== grid) item.width = icon.width;
    if (icon.height !== grid) item.height = icon.height;
    if (hidden) item.hidden = true;
    list[name] = item;
  }
  const data: { [key: string]: Json } = {
    prefix,
    icons: list,
    width: grid,
    height: grid,
  };
  if (state.aliases.size > 0) {
    data.aliases = Object.fromEntries(
      [...state.aliases].map(([alias, parent]) => [alias, { parent }]),
    );
  }
  if (lastModified !== undefined) data.lastModified = lastModified;
  return data;
}

/**
 * Версия набора (ADR-0018): первые 8 символов SHA-256 от icons.json без lastModified. Меняется от
 * любого изменения файла — рисунка, имени, скрытия, алиаса, — поэтому её можно ставить в адреса
 * неизменяемой статики (ADR-0004).
 */
export function versionOf(data: { [key: string]: Json }): string {
  const { lastModified: _time, ...rest } = data;
  return createHash("sha256")
    .update(canonicalJson(rest))
    .digest("hex")
    .slice(0, 8);
}

/** Одинаковые состояния: те же иконки с теми же рисунками и пометками, те же алиасы. */
export function sameState(a: SetState, b: SetState): boolean {
  if (a.icons.size !== b.icons.size || a.aliases.size !== b.aliases.size) {
    return false;
  }
  for (const [name, x] of a.icons) {
    const y = b.icons.get(name);
    if (
      !y ||
      x.hidden !== y.hidden ||
      x.icon.body !== y.icon.body ||
      x.icon.width !== y.icon.width ||
      x.icon.height !== y.icon.height
    ) {
      return false;
    }
  }
  for (const [name, parent] of a.aliases) {
    if (b.aliases.get(name) !== parent) return false;
  }
  return true;
}

/** Сколько видимых иконок: без скрытых и без алиасов. */
export function visibleCount(state: SetState): number {
  let n = 0;
  for (const { hidden } of state.icons.values()) if (!hidden) n++;
  return n;
}
