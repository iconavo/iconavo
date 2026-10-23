// Иконка по имени в наборе IconifyJSON (ADR-0003): цепочка алиасов до иконки и холст. Так же
// считает статика конвейера (resolveChain и effectiveIcon в packages/pipeline/src/cdn/files.ts),
// поэтому SVG ядра без настроек совпадает с файлом статики побайтно. Повороты и отражения в данных
// не поддерживаются: сборка набора их останавливает (ADR-0022), а здесь они дали бы тихо неверную
// картинку. Сообщения ошибок — по-английски: ядро читают разработчики (ADR-0029).

/** Иконка в IconifyJSON: рисунок и, если отличаются от набора, свои размеры. */
export interface IconifyIcon {
  body: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
  hidden?: boolean;
}

/** Алиас — другое имя той же иконки; может переопределить размеры. */
export interface IconifyAlias extends Omit<IconifyIcon, "body"> {
  parent: string;
}

/** Набор или его часть в формате IconifyJSON. */
export interface IconifySet {
  prefix: string;
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, IconifyAlias>;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** Иконка, готовая к рисованию: рисунок и холст. */
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
 * переопределить — ближний к имени главнее. Имени нет — null.
 */
export function iconData(set: IconifySet, name: string): IconData | null {
  const aliases = set.aliases ?? {};
  const chain: IconifyAlias[] = [];
  const seen: string[] = [];
  let current = name;
  while (Object.hasOwn(aliases, current)) {
    if (seen.length >= ALIAS_CHAIN_LIMIT || seen.includes(current)) {
      throw new Error(`Alias "${name}" loops`);
    }
    seen.push(current);
    const alias = aliases[current] as IconifyAlias;
    chain.push(alias);
    current = alias.parent;
  }
  if (!Object.hasOwn(set.icons, current)) {
    if (chain.length === 0) return null;
    throw new Error(`Alias "${name}" does not lead to an icon`);
  }
  const icon = set.icons[current] as IconifyIcon;
  for (const item of [icon, ...chain]) {
    if (item.rotate || item.hFlip || item.vFlip) {
      throw new Error(
        `Icon "${name}" has rotate or flip in its data: not supported`,
      );
    }
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
  return out;
}
