// Запрос к Meilisearch Cloud (ADR-0049): POST /multi-search с ключом только для поиска. Тела строит
// общий модуль поиска — те же, что у замера. Сбой, отказ или ответ не по форме — SearchError: поиск
// отвечает 503, иконки это не задевает. Текст ответа Meilisearch в журнал не идёт: в нём бывает
// запрос пользователя (ADR-0028).

import {
  type MultiSearchQuery,
  parseMultiSearch,
  type SearchHit,
} from "@iconavo-ui/search";

export class SearchError extends Error {}

export interface MeiliConfig {
  url: string;
  key: string;
}

export async function multiSearch(
  fetchFn: typeof fetch,
  config: MeiliConfig,
  queries: readonly MultiSearchQuery[],
  timeoutMs: number,
): Promise<SearchHit[][]> {
  let res: Response;
  try {
    res = await fetchFn(`${config.url.replace(/\/+$/, "")}/multi-search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ queries }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SearchError(`Meilisearch: ${(e as Error).name}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new SearchError(`Meilisearch: HTTP ${res.status}`);
  }
  try {
    return parseMultiSearch(await res.json(), queries.length);
  } catch {
    throw new SearchError("Meilisearch: ответ не по форме");
  }
}
