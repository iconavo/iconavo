// Параметры /search (ADR-0004, ADR-0049): как у Iconify — query, limit, start, prefix, prefixes — и
// наши palette и license. Строже Iconify: неверное значение — 400 с понятным текстом, а не тихо другой
// результат. Ключ кэша строится из нормализованных значений в постоянном порядке: «Дом» и «дом»
// дают один ответ.

import { isValidNamePart } from "@iconavo-ui/core/internal";
import {
  exactName,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  MAX_TOTAL_HITS,
  normalizeText,
  QUERY_MAX_LENGTH,
  type SearchFilters,
  stripSetPrefix,
} from "@iconavo-ui/search";
import { ApiError } from "../http.js";
import { single } from "../params.js";

export interface SearchParams {
  /** Нормализованный текст запроса без префикса набора — для слов и вектора. */
  text: string;
  /** Запрос в виде имени иконки — для правила «точное имя первым»; нет — не похож на имя. */
  exact?: string;
  start: number;
  limit: number;
  filters: SearchFilters;
}

const INTEGER = /^(0|[1-9][0-9]{0,4})$/;
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
/** Наборов и лицензий в фильтре — не больше. */
const MAX_FILTER_VALUES = 50;

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function integer(query: URLSearchParams, name: string): number | undefined {
  const value = single(query, name);
  if (value === undefined) return undefined;
  if (!INTEGER.test(value)) {
    throw new ApiError(
      400,
      "invalid_parameter",
      `Parameter "${name}" must be a whole number`,
    );
  }
  return Number(value);
}

/** Список через запятую: без пустых и повторов, по кодам символов. */
function list(query: URLSearchParams, name: string): string[] {
  const value = single(query, name, 2048);
  if (value === undefined) return [];
  const items = [...new Set(value.split(",").filter((v) => v !== ""))].sort(
    order,
  );
  if (items.length > MAX_FILTER_VALUES) {
    throw new ApiError(
      400,
      "invalid_parameter",
      `Parameter "${name}" lists more than ${MAX_FILTER_VALUES} values`,
    );
  }
  return items;
}

/** Параметры поиска; isSet — есть ли такой набор (по манифесту раздачи). */
export function parseSearchParams(
  query: URLSearchParams,
  isSet: (id: string) => boolean,
): SearchParams {
  const raw = single(query, "query", QUERY_MAX_LENGTH);
  if (raw === undefined) {
    throw new ApiError(
      400,
      "query_required",
      'Parameter "query" with the search text is required',
    );
  }
  const text = normalizeText(stripSetPrefix(raw, isSet));
  const exact = exactName(raw);
  if (text === "" && exact === undefined) {
    throw new ApiError(400, "query_required", 'Parameter "query" is empty');
  }

  const limit = integer(query, "limit") ?? LIMIT_DEFAULT;
  if (limit < 1 || limit > LIMIT_MAX) {
    throw new ApiError(
      400,
      "invalid_limit",
      `Parameter "limit" must be from 1 to ${LIMIT_MAX}`,
    );
  }
  const start = integer(query, "start") ?? 0;
  if (start + limit > MAX_TOTAL_HITS) {
    throw new ApiError(
      400,
      "invalid_start",
      `Parameter "start" plus "limit" must not exceed ${MAX_TOTAL_HITS}`,
    );
  }

  const sets = [
    ...new Set([...list(query, "prefix"), ...list(query, "prefixes")]),
  ].sort(order);
  for (const set of sets) {
    if (!isValidNamePart(set) || !isSet(set)) {
      throw new ApiError(400, "invalid_prefix", `Icon set "${set}" not found`);
    }
  }
  const licenses = list(query, "license");
  for (const license of licenses) {
    if (!LICENSE.test(license)) {
      throw new ApiError(
        400,
        "invalid_license",
        `License "${license}" is not an SPDX identifier`,
      );
    }
  }
  const paletteValue = single(query, "palette");
  let palette: boolean | undefined;
  if (paletteValue !== undefined) {
    if (["1", "true", "yes"].includes(paletteValue)) palette = true;
    else if (["0", "false", "no"].includes(paletteValue)) palette = false;
    else {
      throw new ApiError(
        400,
        "invalid_parameter",
        'Parameter "palette" must be 1 (colored sets) or 0 (monochrome sets)',
      );
    }
  }

  const filters: SearchFilters = {};
  if (sets.length > 0) filters.sets = sets;
  if (palette !== undefined) filters.palette = palette;
  if (licenses.length > 0) filters.licenses = licenses;
  return {
    text,
    ...(exact === undefined ? {} : { exact }),
    start,
    limit,
    filters,
  };
}

/** Параметры ключа кэша: нормализованные значения в постоянном порядке. */
export function searchCacheParams(p: SearchParams): URLSearchParams {
  const out = new URLSearchParams({
    q: p.text,
    exact: p.exact ?? "",
    start: String(p.start),
    limit: String(p.limit),
  });
  if (p.filters.sets) out.set("sets", p.filters.sets.join(","));
  if (p.filters.palette !== undefined) {
    out.set("palette", String(p.filters.palette));
  }
  if (p.filters.licenses) out.set("license", p.filters.licenses.join(","));
  return out;
}
