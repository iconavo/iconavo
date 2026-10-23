// Ключ кэша дата-центра (ADR-0023): поколение, сборка, версия набора, путь и проверенные параметры в
// постоянном порядке. Значения кодирует URLSearchParams: «&», «=» и «%» в значении не подделают чужой
// ключ. Ключ — всегда GET: Cache API хранит только GET, а HEAD берёт тот же ответ.

import { CACHE_GENERATION, CACHE_ORIGIN } from "./config.js";

export function cacheKey(
  build: string,
  version: string,
  path: string,
  params: URLSearchParams,
): Request {
  const query = params.toString();
  return new Request(
    `${CACHE_ORIGIN}/${CACHE_GENERATION}/${build}/${version}${path}${query === "" ? "" : `?${query}`}`,
  );
}
