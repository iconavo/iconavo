// search_icons (ADR-0011, ADR-0044): поиск по смыслу на любом языке тем же кодом, что /search edge
// API, но с ожиданием вектора запроса — ассистенту смысл важнее скорости первого ответа. В ответе —
// имена, стиль, лицензия и автор каждой иконки и одна PNG-картинка: сетка с номерами, номер клетки —
// номер в списке. Готовая картинка — в кэше дата-центра по именам и версиям наборов.

import { type IconData, iconData } from "@iconavo-ui/core/internal";
import type { IconSetSummary, SearchResponse, Style } from "@iconavo-ui/search";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { cacheKey } from "../../../api/src/cache.js";
import { readNames, storeNames } from "../../../api/src/data.js";
import {
  GRID_CACHE,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_OFFSET_MAX,
  SITE_URL,
} from "../config.js";
import type { Call, McpDeps } from "../context.js";
import { toolError } from "../errors.js";
import { gridSvg } from "../grid.js";
import { toBase64 } from "../png.js";
import {
  SetInfoSchema,
  SetPrefix,
  StyleSchema,
  StylesSchema,
} from "../schemas.js";
import { licenseLine, setsInfo } from "../sets.js";

export const SEARCH_NAME = "search_icons";

export const SEARCH_DESCRIPTION = [
  'Find icons by meaning in any language — "shopping cart", "корзина", "delete user" — or by exact name such as "lucide:house".',
  "Searches open-source sets: Lucide, Tabler, Material Symbols, Phosphor and Fluent Emoji Flat; all of them allow commercial use.",
  `Returns up to ${SEARCH_LIMIT_DEFAULT} icons (limit up to ${SEARCH_LIMIT_MAX}) with name, set, style, license and author,`,
  "plus ONE PNG image: a grid of numbered previews, where cell N is result N.",
  "Then call get_icon with the chosen name for ready code. For several icons that must look alike (a menu, a toolbar), use get_matching_set instead.",
].join(" ");

export const SearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(100)
    .describe(
      'What the icon should show, in any language, e.g. "shopping cart", "корзина"; or an exact name such as "lucide:house"',
    ),
  sets: z
    .array(SetPrefix)
    .min(1)
    .max(20)
    .optional()
    .describe('Only these sets, e.g. ["lucide", "tabler"]; default — all sets'),
  style: StyleSchema.optional().describe(
    "Only this style: outline (line icons), filled (solid), duotone (two tones), color (multicolor, emoji)",
  ),
  license: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/)
    .optional()
    .describe('Only icons under this SPDX license, e.g. "MIT"'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT)
    .describe("How many icons to return"),
  offset: z
    .number()
    .int()
    .min(0)
    .max(SEARCH_OFFSET_MAX)
    .default(0)
    .describe("Skip this many results to get the next page"),
  preview: z
    .boolean()
    .default(true)
    .describe(
      "Attach the PNG preview grid; set false if you cannot see images",
    ),
});

export type SearchArgs = z.output<typeof SearchInput>;

export const ResultSchema = z.object({
  n: z.number().int().describe("Number of the cell in the preview image"),
  icon: IconNameOut(),
  set: z.string(),
  style: StyleSchema.nullable(),
  styles: StylesSchema.describe("The same drawing in other styles"),
  exact: z
    .boolean()
    .optional()
    .describe("true — the query was this icon's exact name"),
  license: z.string().describe("SPDX identifier of the set license"),
  author: z.string(),
});

function IconNameOut() {
  return z.string().describe('Full icon name "set:icon"');
}

export const SearchOutput = z.object({
  query: z.string(),
  ranking: z
    .enum(["meaning", "words"])
    .describe(
      "meaning — ranked by meaning and words; words — by words only (the meaning model did not answer)",
    ),
  matched: z
    .boolean()
    .describe(
      "false — no icon matched the words; results are the closest by meaning",
    ),
  offset: z.number().int(),
  count: z.number().int(),
  nextOffset: z
    .number()
    .int()
    .optional()
    .describe("Pass as offset to get more results"),
  results: z.array(ResultSchema),
  sets: z
    .array(SetInfoSchema)
    .describe("Author and license of every set in the results"),
  preview: z.boolean().describe("true — the PNG grid is attached"),
  page: z.string().describe("The same search on iconavo.dev"),
});

export type SearchResult = z.output<typeof SearchOutput>;

const setOf = (name: string) => name.slice(0, name.indexOf(":"));
const bareOf = (name: string) => name.slice(name.indexOf(":") + 1);

/** Стиль показанного имени по карточке: имя совпало с главным именем стиля. */
function styleOf(
  shown: string,
  styles: Partial<Record<Style, string>>,
): Style | null {
  const bare = bareOf(shown);
  for (const [style, name] of Object.entries(styles)) {
    if (name === bare) return style as Style;
  }
  return null;
}

export function searchParams(args: SearchArgs): URLSearchParams {
  const q = new URLSearchParams({
    query: args.query,
    limit: String(args.limit),
    start: String(args.offset),
  });
  if (args.sets !== undefined) q.set("prefixes", args.sets.join(","));
  if (args.style !== undefined) q.set("style", args.style);
  if (args.license !== undefined) q.set("license", args.license);
  return q;
}

/** Рисунок по имени и его каноническое имя: алиас — имя иконки, к которой он ведёт (как /icon). */
export interface ReadIcon {
  canonical: string;
  data: IconData;
}

/**
 * Рисунки по полным именам: файлы имён из кэша дата-центра или R2 (readNames, как у пачек edge API),
 * по одному чтению на набор. Нет файла или рисунка — null.
 */
export async function readIcons(
  deps: McpDeps,
  call: Call,
  names: readonly string[],
): Promise<Map<string, ReadIcon | null>> {
  const manifest = await deps.routes.manifest();
  const sets = [...new Set(names.map(setOf))].sort();
  const icons = new Map<string, ReadIcon | null>();
  await Promise.all(
    sets.map(async (set) => {
      const version = manifest.get(set)?.version ?? "none";
      const bare = [
        ...new Set(names.filter((n) => setOf(n) === set).map(bareOf)),
      ];
      const read = await readNames(deps.bucket, version, set, bare, {
        cache: deps.cache,
        now: deps.now,
        log: deps.log,
      });
      call.waitUntil(storeNames(deps.cache, version, set, read, deps.log));
      for (const name of bare) {
        const file = read.files.get(name);
        const canonical = file ? Object.keys(file.icons)[0] : undefined;
        const data = file ? iconData(file, name) : null;
        icons.set(
          `${set}:${name}`,
          canonical === undefined || data === null
            ? null
            : { canonical: `${set}:${canonical}`, data },
        );
      }
    }),
  );
  return icons;
}

/**
 * Картинка-сетка: из кэша дата-центра или нарисованная заново. Рисунки, уже прочитанные вызывающим
 * (pick_icon), второй раз не читаются.
 */
export async function gridPreview(
  deps: McpDeps,
  call: Call,
  names: readonly string[],
  known?: ReadonlyMap<string, ReadIcon | null>,
): Promise<Uint8Array> {
  const manifest = await deps.routes.manifest();
  const sets = [...new Set(names.map(setOf))].sort();
  const versions = sets.map((s) => manifest.get(s)?.version ?? "none");
  const key = cacheKey(
    deps.build,
    versions.join("-"),
    "/mcp/grid.png",
    new URLSearchParams({ icons: names.join(",") }),
  );
  const hit = await deps.cache.match(key).catch(() => undefined);
  if (hit !== undefined) {
    try {
      return new Uint8Array(await hit.arrayBuffer());
    } catch {
      // Тело записи оборвалось — рисуем заново.
    }
  }
  const missing = names.filter((n) => known?.has(n) !== true);
  const read =
    missing.length === 0 ? new Map() : await readIcons(deps, call, missing);
  const icons = names.map(
    (n) => (known?.get(n) ?? read.get(n) ?? null)?.data ?? null,
  );
  const grid = gridSvg(icons);
  const png = deps.render(grid.svg);
  call.waitUntil(
    deps.cache
      .put(
        key,
        new Response(new Uint8Array(png), {
          headers: { "content-type": "image/png", "cache-control": GRID_CACHE },
        }),
      )
      .catch((e: Error) => deps.log(`картинка не записана: ${e.message}`)),
  );
  return png;
}

function text(result: SearchResult, sets: IconSetSummary[]): string {
  if (result.count === 0) {
    return `No icons found for "${result.query}". Try other words, another language or fewer filters.`;
  }
  const names = new Map(sets.map((s) => [s.prefix, s.name]));
  const lines = [
    `Found ${result.count} icons for "${result.query}"${result.ranking === "meaning" ? ", ranked by meaning" : ", ranked by words only"}.${result.preview ? ` The image shows them numbered 1–${result.count}.` : ""}`,
    ...(result.matched
      ? []
      : [
          "No icon matched the words exactly; these are the closest by meaning.",
        ]),
    "",
    ...result.results.map(
      (r) =>
        `${r.n}. ${r.icon} — ${names.get(r.set) ?? r.set}${r.style === null ? "" : `, ${r.style}`}${r.exact ? " (exact name)" : ""}`,
    ),
    "",
    "Licenses (keep the attribution when you use the icons):",
    ...sets.map((s) => `- ${licenseLine(s)}`),
    ...(result.nextOffset === undefined
      ? []
      : [
          "",
          `More results: call ${SEARCH_NAME} with offset ${result.nextOffset}.`,
        ]),
  ];
  return lines.join("\n");
}

/** Найденное: карточки ответа с лицензией и автором и сведения о наборах. */
export interface FoundIcons {
  ranking: "meaning" | "words";
  matched: boolean;
  results: SearchResult["results"];
  sets: IconSetSummary[];
}

/** Поиск тем же маршрутом, что /search edge API (общий у search_icons и pick_icon). */
export async function findIcons(
  deps: McpDeps,
  call: Call,
  args: SearchArgs,
): Promise<FoundIcons> {
  const params = searchParams(args);
  const url = new URL(`https://mcp.iconavo.dev/search?${params}`);
  const response = await deps.routes.search(
    call.request,
    url,
    call.waitUntil,
    false,
  );
  const found = (await response.json()) as SearchResponse;
  const prefixes = [...new Set(found.icons.map(setOf))];
  const sets = await setsInfo(deps, prefixes);
  const bySet = new Map(sets.map((s) => [s.prefix, s]));
  const results = found.results.map((card, i) => {
    const shown = found.icons[i] ?? card.icon;
    const set = setOf(shown);
    const info = bySet.get(set);
    const styles = Object.fromEntries(
      Object.entries(card.styles).map(([style, name]) => [
        style,
        `${set}:${name}`,
      ]),
    );
    return {
      n: i + 1,
      icon: shown,
      set,
      style: styleOf(shown, card.styles),
      styles,
      ...(card.exact ? { exact: true } : {}),
      license: info?.license.spdx ?? "",
      author: info?.author.name ?? "",
    };
  });
  return {
    ranking: found.semantic === "full" ? "meaning" : "words",
    matched: found.matched,
    results,
    sets,
  };
}

export async function searchIcons(
  deps: McpDeps,
  call: Call,
  args: SearchArgs,
): Promise<CallToolResult> {
  try {
    const { ranking, matched, results, sets } = await findIcons(
      deps,
      call,
      args,
    );
    const withPreview = args.preview && results.length > 0;
    const png = withPreview
      ? await gridPreview(
          deps,
          call,
          results.map((r) => r.icon),
        )
      : undefined;
    const result: SearchResult = {
      query: args.query,
      ranking,
      matched,
      offset: args.offset,
      count: results.length,
      ...(results.length === args.limit &&
      args.offset + args.limit <= SEARCH_OFFSET_MAX
        ? { nextOffset: args.offset + args.limit }
        : {}),
      results,
      sets,
      preview: png !== undefined,
      page: `${SITE_URL}/search?q=${encodeURIComponent(args.query)}`,
    };
    return {
      content: [
        { type: "text", text: text(result, sets) },
        ...(png === undefined
          ? []
          : [
              {
                type: "image" as const,
                data: toBase64(png),
                mimeType: "image/png",
              },
            ]),
      ],
      structuredContent: result,
    };
  } catch (e) {
    return toolError(e, deps.log);
  }
}
