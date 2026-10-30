// Иконка по имени в наборе IconifyJSON (ADR-0003): цепочка алиасов до иконки и холст. Так же
// считает статика конвейера (resolveChain и effectiveIcon в packages/pipeline/src/cdn/files.ts),
// поэтому SVG ядра без настроек совпадает с файлом статики побайтно. Повороты и отражения в данных
// (у Iconify они бывают в алиасах) складываются по цепочке, как mergeIconTransformations у Iconify,
// и сразу применяются к рисунку и холсту — первый проход iconToSVG у Iconify (ADR-0031). В наших
// наборах их нет: сборка статики их останавливает (ADR-0022). Сообщения ошибок — по-английски: ядро
// читают разработчики (ADR-0029).

import { transformIcon } from "./svg.js";

// Типы — те же, что у пакетов данных @iconavo-ui/icons-{набор} (indexDts в
// packages/pipeline/src/npm/files.ts), но шире там, где addIcons принимает IconifyJSON из
// @iconify-json/*: prefix — любая строка, rotate — число. Описания — по-английски: их видят
// разработчики в подсказках редактора.

/** An icon: SVG content without the <svg> element, and its own size if it differs from the set. */
export interface IconavoIcon {
  body: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** Rotation in 90° steps. */
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
  /** Removed by the author: still works by name, but is not listed. */
  hidden?: boolean;
}

/** Another name of an icon; it can override the size. */
export interface IconavoAlias extends Omit<IconavoIcon, "body"> {
  parent: string;
}

/** An icon set or a part of it, in IconifyJSON format. */
export interface IconavoIconSet {
  prefix: string;
  icons: Record<string, IconavoIcon>;
  aliases?: Record<string, IconavoAlias>;
  /** Names that the host does not have. */
  not_found?: string[];
  /** Time of the last release, Unix seconds. */
  lastModified?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** Иконка, готовая к рисованию: рисунок и холст; повороты и отражения из данных уже применены. */
export interface IconData {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Шагов по цепочке алиасов, после которых она считается зацикленной. */
export const ALIAS_CHAIN_LIMIT = 10;

/** Размер по умолчанию в IconifyJSON. */
const DEFAULT_SIZE = 16;

/**
 * Иконка по имени: размеры свои, иначе набора, иначе 16 (left и top — 0); алиасы цепочки могут их
 * переопределить — ближний к имени главнее. Повороты иконки и алиасов складываются, отражения
 * взаимно гасятся; нецелый поворот не учитывается, как у Iconify. Имени нет — null. Рисунок не строка
 * или размеры не числа (например, "24" из чужого JSON) — ошибка: хранилище и обёртка React считают
 * такое имя «нет», а не роняют отрисовку.
 */
export function iconData(set: IconavoIconSet, name: string): IconData | null {
  const aliases = set.aliases ?? {};
  const chain: IconavoAlias[] = [];
  const seen: string[] = [];
  let current = name;
  while (Object.hasOwn(aliases, current)) {
    if (seen.length >= ALIAS_CHAIN_LIMIT || seen.includes(current)) {
      throw new Error(`Alias "${name}" loops`);
    }
    seen.push(current);
    const alias = aliases[current] as IconavoAlias;
    chain.push(alias);
    current = alias.parent;
  }
  if (!Object.hasOwn(set.icons, current)) {
    if (chain.length === 0) return null;
    throw new Error(`Alias "${name}" does not lead to an icon`);
  }
  const icon = set.icons[current] as IconavoIcon;
  let rotate = 0;
  let hFlip = false;
  let vFlip = false;
  for (const item of [icon, ...chain]) {
    if (Number.isInteger(item.rotate)) rotate += item.rotate as number;
    if (item.hFlip) hFlip = !hFlip;
    if (item.vFlip) vFlip = !vFlip;
  }
  const out: IconData = {
    body: icon.body,
    left: icon.left ?? set.left ?? 0,
    top: icon.top ?? set.top ?? 0,
    width: icon.width ?? set.width ?? DEFAULT_SIZE,
    height: icon.height ?? set.height ?? DEFAULT_SIZE,
  };
  for (const alias of chain.reverse()) {
    if (alias.left !== undefined) out.left = alias.left;
    if (alias.top !== undefined) out.top = alias.top;
    if (alias.width !== undefined) out.width = alias.width;
    if (alias.height !== undefined) out.height = alias.height;
  }
  if (
    typeof out.body !== "string" ||
    ![out.left, out.top, out.width, out.height].every(Number.isFinite) ||
    out.width <= 0 ||
    out.height <= 0
  ) {
    throw new Error(`Icon "${name}" has an invalid body or size`);
  }
  rotate = ((rotate % 4) + 4) % 4;
  return rotate || hFlip || vFlip
    ? transformIcon(out, rotate, hFlip, vFlip)
    : out;
}
