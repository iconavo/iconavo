// Сведения об иконке для get_icon и get_matching_set (ADR-0044, ADR-0041): маршрут /icon edge API
// внутри MCP — основное имя после алиаса, набор с автором и лицензией, стиль и варианты, описание,
// похожие в том же стиле. Meilisearch не ответил — сведения попроще из файла имени и оглавления
// каталога: код ассистент получит всё равно, без описания и похожих.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { hasStrokeWidth, iconData } from "@iconavo-ui/core/internal";
import type { IconDetails } from "@iconavo-ui/search";
import { catalogOf } from "../../api/src/catalog.js";
import { readNames, storeNames } from "../../api/src/data.js";
import { ApiError, StorageError } from "../../api/src/http.js";
import { setSummary } from "../../api/src/icon.js";
import { SearchError } from "../../api/src/search/meili.js";
import type { Call, McpDeps } from "./context.js";

export interface Found {
  details: IconDetails;
  /** true — без индекса поиска: нет описания, вариантов и похожих. */
  partial: boolean;
}

const setOf = (name: string) => name.slice(0, name.indexOf(":"));
const bareOf = (name: string) => name.slice(name.indexOf(":") + 1);

/** Файл имени из R2 (через кэш файлов, как у пачек API); нет иконки — 404. */
async function nameFile(
  deps: McpDeps,
  call: Call,
  name: string,
): Promise<{ version: string; file: IconavoIconSet; bare: string }> {
  const set = setOf(name);
  const bare = bareOf(name);
  const entry = (await deps.routes.manifest()).get(set);
  if (entry === undefined) {
    throw new ApiError(404, "set_not_found", `Icon set "${set}" not found`);
  }
  const read = await readNames(deps.bucket, entry.version, set, [bare], {
    cache: deps.cache,
    now: deps.now,
    log: deps.log,
  });
  call.waitUntil(storeNames(deps.cache, entry.version, set, read, deps.log));
  const file = read.files.get(bare);
  if (!file) {
    throw new ApiError(404, "icon_not_found", `Icon "${name}" not found`);
  }
  return { version: entry.version, file, bare };
}

/** Сведения без индекса поиска: основное имя, набор, линии, части других авторов. */
async function basicDetails(
  deps: McpDeps,
  call: Call,
  name: string,
): Promise<IconDetails> {
  const set = setOf(name);
  const { file, bare } = await nameFile(deps, call, name);
  const canonical = Object.keys(file.icons)[0] ?? bare;
  const icon = file.icons[canonical];
  if (icon === undefined) {
    throw new ApiError(404, "icon_not_found", `Icon "${name}" not found`);
  }
  const manifest = await deps.routes.manifest();
  const catalog = catalogOf(manifest);
  const entry = (await deps.routes.catalogIndex(catalog)).sets.get(set);
  if (entry === undefined) {
    throw new StorageError(`набора «${set}» нет в оглавлении ${catalog}`);
  }
  const credits = (entry.credits ?? [])
    .filter((c) => c.icons.includes(canonical))
    .map((c) => ({
      name: c.name,
      author: c.author,
      license: c.license,
      url: c.url,
    }));
  return {
    icon: `${set}:${canonical}`,
    ...(canonical === bare ? {} : { alias: name }),
    ...(icon.hidden === true ? { hidden: true as const } : {}),
    set: setSummary(set, entry),
    card: null,
    style: null,
    variants: [],
    tones: [],
    strokes: hasStrokeWidth(icon.body),
    description: null,
    synonyms: null,
    tags: [],
    ...(credits.length > 0 ? { credits } : {}),
    similar: [],
  };
}

export async function iconDetails(
  deps: McpDeps,
  call: Call,
  name: string,
): Promise<Found> {
  const url = new URL(
    `https://mcp.iconavo.dev/icon?${new URLSearchParams({ icon: name })}`,
  );
  try {
    const res = await deps.routes.icon(
      call.request,
      url,
      call.waitUntil,
      false,
    );
    return { details: (await res.json()) as IconDetails, partial: false };
  } catch (e) {
    if (!(e instanceof SearchError)) throw e;
    deps.log(`сведения об иконке без индекса: ${e.message}`);
    return { details: await basicDetails(deps, call, name), partial: true };
  }
}

/** Рисунок иконки для SVG: повороты и отражения из данных уже применены (iconData ядра). */
export async function iconBody(deps: McpDeps, call: Call, name: string) {
  const { file, bare } = await nameFile(deps, call, name);
  const data = iconData(file, bare);
  if (data === null) {
    throw new ApiError(404, "icon_not_found", `Icon "${name}" not found`);
  }
  return data;
}
