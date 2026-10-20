// Отпечаток иконки (ADR-0018): первые 12 символов SHA-256 от размеров и тела. Считается с шага 7 —
// без него search.json не проходит схему; шаг 8 по нему ведёт журнал и находит переименования.

import { createHash } from "node:crypto";
import type { NormalizedIcon } from "../normalize/normalize.js";

/**
 * ID внутри тела содержат имя иконки: `{набор}--{иконка}-{n}` (ADR-0014). Перед подсчётом имя
 * заменяется заглушкой, иначе переименованная иконка с ID получила бы другой отпечаток.
 */
export function fingerprint(
  prefix: string,
  name: string,
  icon: NormalizedIcon,
): string {
  const body = icon.body.replaceAll(`${prefix}--${name}-`, "{id}-");
  return createHash("sha256")
    .update(JSON.stringify([icon.width, icon.height, body]))
    .digest("hex")
    .slice(0, 12);
}
