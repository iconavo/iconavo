// Набор иконки — автор и лицензия для каждого ответа (ADR-0011): из оглавления каталога раздачи, тем
// же правилом, что у адреса /icon edge API (setSummary).

import type { IconSetSummary } from "@iconavo-ui/search";
import { catalogOf } from "../../api/src/catalog.js";
import { StorageError } from "../../api/src/http.js";
import { setSummary } from "../../api/src/icon.js";
import type { McpDeps } from "./context.js";

/** Сведения о наборах по префиксам, в том же порядке; набора нет в оглавлении — ошибка хранилища. */
export async function setsInfo(
  deps: McpDeps,
  prefixes: readonly string[],
): Promise<IconSetSummary[]> {
  const manifest = await deps.routes.manifest();
  const catalog = catalogOf(manifest);
  const index = await deps.routes.catalogIndex(catalog);
  return prefixes.map((prefix) => {
    const entry = index.sets.get(prefix);
    if (entry === undefined) {
      throw new StorageError(`набора «${prefix}» нет в оглавлении ${catalog}`);
    }
    return setSummary(prefix, entry);
  });
}

/** Строка для текста ответа: «Lucide — ISC, Lucide Contributors (url)», и части других авторов. */
export function licenseLine(set: IconSetSummary): string {
  const license = set.license.url
    ? `${set.license.spdx} (${set.license.url})`
    : set.license.spdx;
  const author = set.author.url
    ? `${set.author.name} (${set.author.url})`
    : set.author.name;
  const credits = (set.credits ?? [])
    .map((c) => ` Includes icons from ${c.name} by ${c.author}, ${c.license}.`)
    .join("");
  return `${set.name} [${set.prefix}] — ${license} — ${author}.${credits}`;
}
