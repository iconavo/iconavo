// Песочница ядра пакета (фаза 3, шаги 2 и 3): страница со 100 иконками, журналом запросов и
// имитацией сбоев хостов. Иконки грузит само ядро из packages/core/dist — так же, как оно будет
// работать у разработчиков.

import { API_HOST, PREVIEW_PORT } from "../api/config.js";

/** Порт по умолчанию: 4280 — страница поиска, 4281 — превью API. */
export const SANDBOX_PORT = 4282;

/** Хост API по умолчанию — живой edge API. */
export const LIVE_API = `https://${API_HOST}`;

/** Другой допустимый хост — функция превью на этом компьютере: pnpm api preview. */
export const LOCAL_API = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/;

/** Адрес превью API по умолчанию — для ссылки на странице. */
export const PREVIEW_API = `http://127.0.0.1:${PREVIEW_PORT}`;

/** Статика превью — файлы dist-cdn/ по этому пути (api/preview.ts): в режиме превью всё на этом компьютере. */
export const PREVIEW_STATIC = "/_static";

/**
 * «Медленный» хост: запрос уходит позже на столько — дольше обоих порогов ядра (750 мс между хостами,
 * 1,5 с с API на статику), короче попытки 5 с.
 */
export const SLOW_MS = 2000;

/** Иконки, которых нет: имени нет в наборе, набора нет, имя не по правилу ADR-0001. */
export const MISSING_NAMES = [
  "lucide:no-such-icon",
  "nope:house",
  "Lucide:House",
] as const;

/** Сколько иконок показывать за раз; по умолчанию — 100. */
export const COUNTS = [20, 100, 500] as const;
export const DEFAULT_COUNT = 100;

/** Набор по умолчанию и имён каждого набора в режиме «все пять». */
export const DEFAULT_SET = "lucide";
export const PER_SET = 20;

/** Страница «5000 иконок» (шаг 5): столько первых видимых имён каждого набора — 5 × 1000. */
export const MANY_PER_SET = 1000;

/** «Медленный скрипт» на странице 5000 иконок: скрипт тега приходит на столько позже. */
export const SLOW_SCRIPT_MS = 2000;

/** Задержка скрипта тега по ?delay= — не дольше: сервер песочницы не держит запрос вечно. */
export const MAX_SCRIPT_DELAY_MS = 10_000;

/** Заглушки на странице тега: ответ своего загрузчика через столько миллисекунд. */
export const SLOW_LOADER_MS = [1000, 3000] as const;
