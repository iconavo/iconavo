// Пачка (ADR-0024): IconifyJSON с иконками, всей цепочкой алиасов и not_found, как у Iconify.
// aliases есть всегда, not_found — только если что-то не нашлось. Размеры набора — из файлов имён:
// у всех имён набора они одинаковые; не нашлось ничего — без размеров.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { compactJson, type Json } from "./json.js";
import type { SetEntry } from "./manifest.js";

export function batchBody(
  set: string,
  entry: SetEntry,
  names: readonly string[],
  files: ReadonlyMap<string, IconavoIconSet | null>,
): string {
  const icons: { [key: string]: Json } = {};
  const aliases: { [key: string]: Json } = {};
  const notFound: string[] = [];
  let sizes: IconavoIconSet | undefined;
  for (const name of names) {
    const file = files.get(name);
    if (!file) {
      notFound.push(name);
      continue;
    }
    sizes ??= file;
    Object.assign(icons, file.icons);
    Object.assign(aliases, file.aliases ?? {});
  }
  const out: { [key: string]: Json } = {
    prefix: set,
    lastModified: entry.lastModified,
    icons,
    aliases,
  };
  for (const key of ["left", "top", "width", "height"] as const) {
    const value = sizes?.[key];
    if (value !== undefined) out[key] = value;
  }
  if (notFound.length > 0) out.not_found = notFound;
  return compactJson(out);
}
