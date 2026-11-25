// Набор иконки — автор и лицензия для каждого ответа (ADR-0011): из оглавления каталога раздачи, тем
// же правилом, что у адреса /icon edge API (setSummary).

import type { IconCredit, IconSetSummary } from "@iconavo-ui/search";
import { catalogOf, type IndexEntry } from "../../api/src/catalog.js";
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

/**
 * Части иконки от других авторов по записи оглавления (Feather у Lucide, ADR-0017) — тем же правилом,
 * что /icon: имя — каноническое, в списке автора части. Одно правило у сведений об иконке, сетки выбора
 * и get_matching_set (ревизия фазы 5, А-7).
 */
export function creditsOf(
  entry: Pick<IndexEntry, "credits"> | undefined,
  bare: string,
): IconCredit[] {
  return (entry?.credits ?? [])
    .filter((c) => c.icons.includes(bare))
    .map((c) => ({
      name: c.name,
      author: c.author,
      license: c.license,
      url: c.url,
    }));
}

/** Части от других авторов у каждой иконки (creditsOf). Нет частей — имени в ответе нет. */
export async function iconCredits(
  deps: McpDeps,
  names: readonly string[],
): Promise<Map<string, IconCredit[]>> {
  const manifest = await deps.routes.manifest();
  const index = await deps.routes.catalogIndex(catalogOf(manifest));
  const out = new Map<string, IconCredit[]>();
  for (const name of names) {
    const colon = name.indexOf(":");
    const credits = creditsOf(
      index.sets.get(name.slice(0, colon)),
      name.slice(colon + 1),
    );
    if (credits.length > 0) out.set(name, credits);
  }
  return out;
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
