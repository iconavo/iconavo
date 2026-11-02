// Запросы к Meilisearch Cloud (ADR-0049) с ключом только для поиска: POST /multi-search и похожие
// документы /indexes/icons/similar (шаг 4 фазы 4) — им тоже хватает права search. Тела строит общий
// модуль поиска — те же, что у замера. Сбой, отказ или ответ не по форме — SearchError: поиск и /icon
// отвечают 503, иконки это не задевает. Текст ответа Meilisearch в журнал не идёт: в нём бывает
// запрос пользователя (ADR-0028).

import {
  type MultiSearchQuery,
  parseMultiSearch,
  type SearchHit,
  SIMILAR_PATH,
  type similarBody,
} from "@iconavo-ui/search";

export class SearchError extends Error {}

export interface MeiliConfig {
  url: string;
  key: string;
}

/** POST к Meilisearch: ответ с любым кодом; сеть или таймаут — SearchError. */
async function post(
  fetchFn: typeof fetch,
  config: MeiliConfig,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchFn(`${config.url.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SearchError(`Meilisearch: ${(e as Error).name}`);
  }
}

/** Тело ответа; не 2xx — SearchError. */
async function okJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    await res.body?.cancel();
    throw new SearchError(`Meilisearch: HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new SearchError("Meilisearch: ответ не JSON");
  }
}

/** Ответ multi-search как есть — для запросов с полями сверх карточки (/icon). */
export async function multiSearchJson(
  fetchFn: typeof fetch,
  config: MeiliConfig,
  queries: readonly MultiSearchQuery[],
  timeoutMs: number,
): Promise<unknown[]> {
  const json = await okJson(
    await post(fetchFn, config, "/multi-search", { queries }, timeoutMs),
  );
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length !== queries.length) {
    throw new SearchError("Meilisearch: ответ не по форме");
  }
  return results;
}

export async function multiSearch(
  fetchFn: typeof fetch,
  config: MeiliConfig,
  queries: readonly MultiSearchQuery[],
  timeoutMs: number,
): Promise<SearchHit[][]> {
  const json = await okJson(
    await post(fetchFn, config, "/multi-search", { queries }, timeoutMs),
  );
  try {
    return parseMultiSearch(json, queries.length);
  } catch {
    throw new SearchError("Meilisearch: ответ не по форме");
  }
}

/**
 * Похожие документы. 400 и 404 — у документа нет вектора (иконка без описания) или его уже нет в
 * индексе: undefined, похожих нет. Остальные отказы, в том числе 401 и 403, — SearchError: молча
 * пустой блок прятал бы неверный ключ.
 */
export async function similarJson(
  fetchFn: typeof fetch,
  config: MeiliConfig,
  body: ReturnType<typeof similarBody>,
  timeoutMs: number,
): Promise<unknown | undefined> {
  const res = await post(fetchFn, config, SIMILAR_PATH, body, timeoutMs);
  if (res.status === 400 || res.status === 404) {
    await res.body?.cancel();
    return undefined;
  }
  return okJson(res);
}
