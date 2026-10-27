// Песочница ядра пакета (фаза 3, шаг 2): страница со 100 иконками и журналом запросов. Иконки грузит
// само ядро из packages/core/dist — так же, как оно будет работать у разработчиков.

import { API_HOST, PREVIEW_PORT } from "../api/config.js";

/** Порт по умолчанию: 4280 — страница поиска, 4281 — превью API. */
export const SANDBOX_PORT = 4282;

/** Хост API по умолчанию — живой edge API. */
export const LIVE_API = `https://${API_HOST}`;

/** Другой допустимый хост — функция превью на этом компьютере: pnpm api preview. */
export const LOCAL_API = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/;

/** Адрес превью API по умолчанию — для ссылки на странице. */
export const PREVIEW_API = `http://127.0.0.1:${PREVIEW_PORT}`;

/** Сколько иконок показывать за раз; по умолчанию — 100. */
export const COUNTS = [20, 100, 500] as const;
export const DEFAULT_COUNT = 100;

/** Набор по умолчанию и имён каждого набора в режиме «все пять». */
export const DEFAULT_SET = "lucide";
export const PER_SET = 20;
