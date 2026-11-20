// get_matching_set (ADR-0011, ADR-0044): несколько иконок в одном виде — один набор, один стиль и один
// вариант, — например для меню: «дом, поиск, уведомления, профиль». Образец like (иконка, которая уже
// есть в проекте) задаёт набор, стиль и вариант через сведения /icon: like = ph:house-bold — все иконки
// придут как ph:*-bold. Без образца набор и стиль выбираются по тому, где нашлось больше понятий.
// Все понятия ищутся одним запросом multi-search к Meilisearch (тела — общий модуль поиска, та же
// доля смысла, что у /search), векторы недостающих понятий — одним вызовом Polza: обращений к
// хранилищам и сервисам — несколько на вызов, а не на понятие.

import { hasStrokeWidth, iconData } from "@iconavo-ui/core/internal";
import {
  mainQuery,
  normalizeText,
  SEARCH_MODEL,
  SEARCH_RATE,
  SEMANTIC_RATIO,
  type SearchFilters,
  type SearchHit,
  STYLES,
  type Style,
  stripSetPrefix,
  vectorHash,
} from "@iconavo-ui/search";
import { attributionText } from "@iconavo-ui/snippets/icon";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { catalogOf } from "../../../api/src/catalog.js";
import { MEILI_TIMEOUT_MS, MODEL_TIMEOUT_MS } from "../../../api/src/config.js";
import { readNames, storeNames } from "../../../api/src/data.js";
import { ApiError } from "../../../api/src/http.js";
import { limitKey } from "../../../api/src/search/handler.js";
import { multiSearch, SearchError } from "../../../api/src/search/meili.js";
import {
  cachedVector,
  modelVectors,
  rememberVector,
  storedVector,
} from "../../../api/src/search/vectors.js";
import {
  codeOf,
  FORMATS,
  jsxOnly,
  LookFields,
  settingsOf,
  setupFor,
} from "../code.js";
import {
  MATCH_ALTERNATIVES,
  MATCH_MAX,
  MATCH_MIN,
  MATCH_POOL,
} from "../config.js";
import type { Call, McpDeps } from "../context.js";
import { iconDetails } from "../details.js";
import { toolError } from "../errors.js";
import { IconName, SetInfoSchema, SetPrefix, StyleSchema } from "../schemas.js";
import { setsInfo } from "../sets.js";

export const MATCHING_NAME = "get_matching_set";

export const MATCHING_DESCRIPTION = [
  "Get several icons that look consistent — one set, one style and the same variant (e.g. the same weight) — for a group of concepts in any language,",
  'e.g. a navigation bar: ["home", "search", "notifications", "profile"].',
  'Pass like with an icon already used in the project (e.g. "ph:house-bold") to match its set, style and variant; or pass set and style;',
  "otherwise the set and style that cover the most concepts are chosen.",
  "Returns one icon per concept with ready code, two alternatives and the license and author of the set.",
].join(" ");

export const MatchingInput = z.object({
  concepts: z
    .array(z.string().min(1).max(100))
    .min(MATCH_MIN)
    .max(MATCH_MAX)
    .describe(
      'What each icon should show, in any language, e.g. ["home", "search", "notifications", "profile"]',
    ),
  like: IconName.optional().describe(
    'An icon already used in the project: its set, style and variant are matched, e.g. "ph:house-bold"',
  ),
  set: SetPrefix.optional().describe(
    "Use this set; default — the set that covers the most concepts",
  ),
  style: StyleSchema.optional(),
  ...LookFields,
});

export type MatchingArgs = z.output<typeof MatchingInput>;

const SetupSchema = z.object({
  install: z.string(),
  import: z.string(),
  script: z.string().optional(),
});

export const MatchingOutput = z.object({
  set: SetInfoSchema,
  style: StyleSchema.nullable(),
  variant: z
    .string()
    .nullable()
    .describe('Variant suffix taken from like, e.g. "-bold"'),
  format: z.enum(FORMATS),
  icons: z.array(
    z.object({
      concept: z.string(),
      icon: z.string(),
      code: z.string(),
      alternatives: z.array(z.string()),
    }),
  ),
  missing: z
    .array(z.string())
    .describe("Concepts without an icon in this set and style"),
  setup: SetupSchema.optional().describe(
    "For html and react, once per project",
  ),
  attribution: z
    .string()
    .describe("Attribution text to keep with the icons (license and author)"),
  notes: z.array(z.string()),
});

export type MatchingResult = z.output<typeof MatchingOutput>;

const setOf = (name: string) => name.slice(0, name.indexOf(":"));
const bareOf = (name: string) => name.slice(name.indexOf(":") + 1);

/** Суффикс варианта образца: ph:house-bold у карточки ph:house — «-bold». */
export function variantSuffix(icon: string, card: string | null): string {
  return card !== null && icon.startsWith(`${card}-`)
    ? icon.slice(card.length)
    : "";
}

/**
 * Набор, где нашлось больше понятий; при равенстве — где они выше в выдаче, затем — порядок наборов
 * в каталоге.
 */
export function chooseSet(
  lists: readonly SearchHit[][],
  order: readonly string[],
): string | undefined {
  const stats = new Map<string, { covered: number; ranks: number }>();
  for (const hits of lists) {
    const seen = new Set<string>();
    hits.forEach((hit, rank) => {
      const set = setOf(hit.icon);
      if (seen.has(set)) return;
      seen.add(set);
      const s = stats.get(set) ?? { covered: 0, ranks: 0 };
      s.covered += 1;
      s.ranks += rank;
      stats.set(set, s);
    });
  }
  const score = (set: string) => {
    const s = stats.get(set) ?? { covered: 0, ranks: 0 };
    return {
      covered: s.covered,
      ranks: s.ranks + (lists.length - s.covered) * MATCH_POOL,
    };
  };
  const at = (set: string) => {
    const i = order.indexOf(set);
    return i < 0 ? order.length : i;
  };
  return [...stats.keys()].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y.covered - x.covered || x.ranks - y.ranks || at(a) - at(b);
  })[0];
}

/** Стиль, в котором есть лучшие иконки большинства понятий в наборе; при равенстве — порядок шкалы. */
export function chooseStyle(
  lists: readonly SearchHit[][],
  set: string,
): Style | undefined {
  const counts = new Map<Style, number>();
  for (const hits of lists) {
    const best = hits.find((h) => setOf(h.icon) === set);
    for (const style of Object.keys(best?.styles ?? {}) as Style[]) {
      counts.set(style, (counts.get(style) ?? 0) + 1);
    }
  }
  return [...STYLES]
    .filter((s) => counts.has(s))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
}

/** Имя иконки карточки в нужном стиле и варианте: вариант образца, если он у карточки есть. */
export function pickName(
  hit: SearchHit,
  style: Style | undefined,
  suffix: string,
): string {
  const set = setOf(hit.icon);
  const base = bareOf(hit.icon);
  if (suffix !== "") {
    const candidate = `${base}${suffix}`;
    if (hit.variants.includes(candidate) || hit.tones.includes(candidate)) {
      return `${set}:${candidate}`;
    }
  }
  const styled = style === undefined ? undefined : hit.styles[style];
  return `${set}:${styled ?? base}`;
}

/** Векторы понятий: кэш дата-центра, фразы каталога в бакете, недостающие — одним вызовом Polza. */
async function conceptVectors(
  deps: McpDeps,
  call: Call,
  texts: readonly string[],
): Promise<(Float32Array | undefined)[]> {
  const hashes = await Promise.all(
    texts.map((t) =>
      t === "" ? Promise.resolve(undefined) : vectorHash(SEARCH_MODEL.id, t),
    ),
  );
  const out = await Promise.all(
    hashes.map(async (hash) => {
      if (hash === undefined) return undefined;
      const cached = await cachedVector(deps.cache, hash).catch(
        () => undefined,
      );
      if (cached !== undefined) return cached;
      return storedVector(deps.search.bucket, hash).catch(() => undefined);
    }),
  );
  const missing = out.flatMap((v, i) =>
    v === undefined && hashes[i] !== undefined ? [i] : [],
  );
  if (missing.length > 0 && deps.search.polzaKey !== undefined) {
    try {
      const vectors = await modelVectors(
        deps.search.fetch,
        deps.search.polzaKey,
        missing.map((i) => texts[i] as string),
        MODEL_TIMEOUT_MS,
      );
      missing.forEach((i, k) => {
        const vector = vectors[k];
        const hash = hashes[i];
        if (vector === undefined || hash === undefined) return;
        out[i] = vector;
        call.waitUntil(
          rememberVector(deps.cache, hash, vector).catch((e: Error) =>
            deps.log(`вектор понятия не запомнен: ${e.message}`),
          ),
        );
      });
    } catch (e) {
      // Модель не ответила — понятия ищутся словами.
      deps.log(`векторы понятий: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function matchingSet(
  deps: McpDeps,
  call: Call,
  args: MatchingArgs,
): Promise<CallToolResult> {
  try {
    // Лимит частоты поиска — один на вызов: все понятия — один запрос к Meilisearch.
    if (deps.search.limiter) {
      let allowed = true;
      try {
        allowed = (
          await deps.search.limiter.limit({
            key: limitKey(call.request.headers.get("cf-connecting-ip")),
          })
        ).success;
      } catch (e) {
        deps.log(`лимит частоты не ответил: ${(e as Error).message}`);
      }
      if (!allowed) {
        throw new ApiError(
          429,
          "rate_limited",
          `Too many searches: at most ${SEARCH_RATE.limit} per minute from one address, retry later`,
        );
      }
    }
    const meili = deps.search.meili;
    if (!meili) throw new SearchError("нет ключей Meilisearch");
    const notes: string[] = [];
    let set = args.set;
    let style: Style | undefined = args.style;
    let suffix = "";
    if (args.like !== undefined) {
      const { details } = await iconDetails(deps, call, args.like);
      if (set !== undefined && set !== details.set.prefix) {
        notes.push(
          `The set is taken from ${details.icon}: ${details.set.prefix}.`,
        );
      }
      set = details.set.prefix;
      style = details.style ?? style;
      suffix = variantSuffix(details.icon, details.card);
    }
    const manifest = await deps.routes.manifest();
    if (set !== undefined && !manifest.has(set)) {
      throw new ApiError(400, "invalid_prefix", `Icon set "${set}" not found`);
    }
    const texts = args.concepts.map((c) =>
      normalizeText(stripSetPrefix(c, (id) => manifest.has(id))),
    );
    const vectors = await conceptVectors(deps, call, texts);
    const queries = (filters: SearchFilters, limit: number) =>
      texts.map((q, i) => {
        const vector = vectors[i];
        return mainQuery({
          q,
          filters,
          start: 0,
          limit,
          ...(vector === undefined
            ? {}
            : { vector, semanticRatio: SEMANTIC_RATIO }),
        });
      });
    const catalog = await deps.routes.catalogIndex(catalogOf(manifest));
    if (set === undefined) {
      const lists = await multiSearch(
        deps.search.fetch,
        meili,
        queries(style === undefined ? {} : { style }, MATCH_POOL),
        MEILI_TIMEOUT_MS,
      );
      set = chooseSet(lists, [...catalog.sets.keys()]);
      if (set === undefined) {
        throw new ApiError(404, "icon_not_found", "No icons found");
      }
      style ??= chooseStyle(lists, set);
    } else if (style === undefined) {
      const lists = await multiSearch(
        deps.search.fetch,
        meili,
        queries({ sets: [set] }, MATCH_POOL),
        MEILI_TIMEOUT_MS,
      );
      style = chooseStyle(lists, set);
    }
    const chosenSet = set;
    const lists = await multiSearch(
      deps.search.fetch,
      meili,
      queries(
        { sets: [chosenSet], ...(style === undefined ? {} : { style }) },
        1 + MATCH_ALTERNATIVES,
      ),
      MEILI_TIMEOUT_MS,
    );
    const picked = lists.map((hits) =>
      hits.map((hit) => pickName(hit, style, suffix)),
    );
    // Рисунки выбранных иконок: меняет ли их толщина линии, а для SVG — сам рисунок.
    const names = [
      ...new Set(picked.flatMap((p) => (p[0] === undefined ? [] : [p[0]]))),
    ];
    const version = manifest.get(chosenSet)?.version ?? "";
    const read = await readNames(
      deps.bucket,
      version,
      chosenSet,
      names.map(bareOf),
      { cache: deps.cache, now: deps.now, log: deps.log },
    );
    call.waitUntil(storeNames(deps.cache, version, chosenSet, read, deps.log));
    const [info] = await setsInfo(deps, [chosenSet]);
    if (info === undefined) throw new Error("нет сведений о наборе");
    const settings = settingsOf(args);
    const icons: MatchingResult["icons"] = [];
    const missing: string[] = [];
    args.concepts.forEach((concept, i) => {
      const [name, ...alternatives] = picked[i] ?? [];
      const file =
        name === undefined ? undefined : read.files.get(bareOf(name));
      const icon =
        name === undefined || !file ? null : iconData(file, bareOf(name));
      if (name === undefined || icon === null) {
        missing.push(concept);
        return;
      }
      const applies = {
        palette: info.palette,
        strokes: hasStrokeWidth(icon.body),
      };
      const code = codeOf(
        args.format,
        name,
        settings,
        applies,
        deps.usage.install,
        { icon, details: { set: info } },
      );
      icons.push({
        concept,
        icon: name,
        code: args.format === "react" ? jsxOnly(code.code) : code.code,
        alternatives,
      });
    });
    if (args.color !== undefined && info.palette) {
      notes.push(`Color is not applied: ${info.name} is a multicolor set.`);
    }
    const result: MatchingResult = {
      set: info,
      style: style ?? null,
      variant: suffix === "" ? null : suffix,
      format: args.format,
      icons,
      missing,
      ...(args.format === "html" || args.format === "react"
        ? { setup: setupFor(args.format, deps.usage.install) }
        : {}),
      attribution: attributionText({ set: info }),
      notes,
    };
    return {
      content: [{ type: "text", text: text(result) }],
      structuredContent: result,
    };
  } catch (e) {
    return toolError(e, deps.log);
  }
}

function text(r: MatchingResult): string {
  const look = [
    r.style,
    r.variant === null ? null : `variant ${r.variant}`,
  ].filter((x) => x !== null);
  return [
    `Matching icons from ${r.set.name}${look.length === 0 ? "" : ` (${look.join(", ")})`}:`,
    ...r.icons
      .flatMap((x) => [
        `- ${x.concept} → ${x.icon}${x.alternatives.length === 0 ? "" : ` (alternatives: ${x.alternatives.join(", ")})`}`,
        r.format === "html" || r.format === "react" ? `  ${x.code}` : "",
      ])
      .filter((line) => line !== ""),
    ...(r.missing.length === 0
      ? []
      : [`No icon in this set for: ${r.missing.join(", ")}.`]),
    ...(r.format === "svg"
      ? ["SVG markup of each icon is in the structured result (icons[].code)."]
      : r.format === "css"
        ? [
            "The CSS class and the element of each icon are in the structured result (icons[].code).",
          ]
        : []),
    "",
    ...(r.setup === undefined
      ? []
      : [
          `Setup, once per project: ${r.setup.install}, then ${r.setup.import}.${r.format === "react" ? "" : " Without a build step — the <script> and <style> lines from get_usage."}`,
        ]),
    ...r.notes,
    `License — keep this attribution: ${r.attribution}`,
  ].join("\n");
}
