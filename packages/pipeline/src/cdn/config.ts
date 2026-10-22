// Настройки раздачи: сборка (ADR-0022) — имена папок и файлов, параллельность записи, пределы отчёта;
// выгрузка на два хоста (ADR-0022, ADR-0025) и проверка живых адресов (ADR-0023).

/** Папка раздачи в корне репозитория; в git не попадает. */
export const OUT_DIR = "dist-cdn";
/** Папка версий внутри раздачи: v/{версия}/{набор}/… (ADR-0004). */
export const VERSIONS_DIR = "v";
/** Манифест текущих версий в корне раздачи. */
export const MANIFEST_FILE = "manifest.json";
/** Файл контрольных сумм версии набора лежит рядом с папкой набора: v/{версия}/{набор}.checksums.json. */
export const CHECKSUMS_SUFFIX = ".checksums.json";
/** Алгоритм контрольных сумм — как у отпечатков иконок (ADR-0018). */
export const CHECKSUM_ALGORITHM = "sha256";
/** Хост статики (ADR-0004) — в отчёте, чтобы показать, каким адресом станет путь файла. */
export const CDN_HOST = "cdn.iconavo.dev";
/** Одновременных записей файлов: файловые операции Node идут через четыре потока, больше — лишь очередь. */
export const WRITE_CONCURRENCY = 32;
/** Сколько файлов показывает дерево папок в отчёте. */
export const TREE_LIMIT = 30;
/** Сколько строк контрольных сумм показывает отчёт. */
export const CHECKSUMS_LIMIT = 8;
/** Шагов по цепочке алиасов, после которых цепочка считается зацикленной. */
export const CHAIN_LIMIT = 10;

// Выгрузка в R2 (шаг 2 фазы 2, ADR-0022, ADR-0023).

/** Бакет R2 с раздачей; к нему подключён домен cdn.iconavo.dev (бакет создал владелец 22 октября 2026). */
export const R2_BUCKET = "iconavo-cdn";
/** Регион в подписи запросов — у R2 всегда auto. */
export const R2_REGION = "auto";
/** Адрес S3-совместимого API R2 для аккаунта. */
export const r2Endpoint = (accountId: string) =>
  `https://${accountId}.r2.cloudflarestorage.com`;
/** Переменные окружения с ключами R2: локально — .env, в CI — секреты GitHub Actions. */
export const R2_ENV = {
  accountId: "R2_ACCOUNT_ID",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
} as const;
/**
 * Одновременных записей в хранилище: общего лимита запросов у R2 нет, предел — одна запись в секунду в
 * один ключ; Bunny принимает до 100 соединений с одного адреса.
 */
export const UPLOAD_CONCURRENCY = 32;
/** Ключей на страницу списка объектов — максимум S3. */
export const LIST_PAGE_SIZE = 1000;
/** Ожидание одного ответа R2 и число попыток; паузы между ними — как у Polza (embed/config.ts). */
export const UPLOAD_TIMEOUT_MS = 60_000;
export const UPLOAD_MAX_ATTEMPTS = 5;
/** Через сколько выгруженных файлов набора печатать строку о ходе выгрузки. */
export const PROGRESS_EVERY = 5000;
/** Тип содержимого по расширению файла раздачи (ADR-0023). */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
};
/** Cache-Control (ADR-0023): файлы версии не меняются никогда — год и immutable; манифест — 5 минут. */
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_MANIFEST = "public, max-age=300";
/** Сколько расхождений перечисляет сообщение «СТОП». */
export const MISMATCH_LIMIT = 5;

// Проверка раздачи по живым адресам (шаг 3 фазы 2, ADR-0023): pnpm cdn check.

/** Образец проверки: имена не пропадают (ADR-0005), поэтому адрес есть в любой версии набора. */
export const CHECK_SET = "lucide";
export const CHECK_ICON = "heart";
/** Имя, которого нет ни в одной версии: «_» запрещён правилом имён (ADR-0001). */
export const CHECK_MISSING = "_missing";
/** Origin первого запроса к адресу — как у чужого сайта; второй запрос идёт без Origin. */
export const CHECK_ORIGIN = "https://example.com";
/** Ожидание одного ответа и число попыток: с медленного соединения новое подключение — до 10 с. */
export const CHECK_TIMEOUT_MS = 30_000;
export const CHECK_MAX_ATTEMPTS = 3;
/** CORS для всех источников, как у Iconify. */
export const CORS_ALLOW_ORIGIN = "*";
/** Заголовки защиты у каждого ответа хоста, включая 404 (имена — строчными, как их отдаёт fetch). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "cross-origin",
};
/** Политика безопасности SVG: открытый напрямую файл не выполнит код и ничего не загрузит. */
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/** cf-cache-status файлов версии: ответ из кэша CDN или положен в него (первый запрос — MISS). */
export const EDGE_CACHED: readonly string[] = [
  "HIT",
  "MISS",
  "EXPIRED",
  "STALE",
  "REVALIDATED",
  "UPDATING",
];
/** cf-cache-status манифеста: CDN его не хранит, каждый запрос читает R2. */
export const EDGE_DIRECT: readonly string[] = ["DYNAMIC", "BYPASS"];
/** Правила Cloudflare в зоне iconavo.dev — для подсказок; дословно они записаны в ADR-0023. */
export const CF_CACHE_RULE = "Раздача: кэш по заголовкам файлов";
export const CF_HEADERS_RULE = "Раздача: CORS и защита";
export const CF_SVG_RULE = "Раздача: CSP для SVG";

// Второй хост — Bunny (шаг 4 фазы 2, ADR-0025): та же раскладка у независимого провайдера.

/** Хост второй копии раздачи (ADR-0004). */
export const CDN2_HOST = "cdn2.iconavo.dev";
/** Хранилище Bunny (Storage Zone) с раздачей; к нему подключена зона CDN с адресом cdn2.iconavo.dev. */
export const BUNNY_STORAGE_ZONE = "iconavo-cdn";
/** HTTP-интерфейс хранилища — по основному региону зоны: у Франкфурта адрес без приставки. */
export const BUNNY_STORAGE_ENDPOINT = "https://storage.bunnycdn.com";
/** Переменная окружения с паролем хранилища: локально — .env, в CI — секрет GitHub Actions. */
export const BUNNY_ENV = { password: "BUNNY_STORAGE_PASSWORD" } as const;
/** Ожидание списка папки: у material-symbols в одной папке около 47 тысяч файлов, ответ около 20 МБ. */
export const BUNNY_LIST_TIMEOUT_MS = 120_000;
/** Правила зоны CDN Bunny — для подсказок; дословно они записаны в ADR-0025. */
export const BUNNY_CACHE_RULE = "Раздача: кэш версий";
export const BUNNY_MANIFEST_RULE = "Раздача: манифест мимо кэша";
export const BUNNY_HEADERS_RULE = "Раздача: CORS и защита";
export const BUNNY_SVG_RULE = "Раздача: CSP для SVG";
/** Тип файла Bunny отдаёт по расширению, без charset: тип с charset ставят эти правила. */
export const BUNNY_JSON_TYPE_RULE = "Раздача: тип JSON";
export const BUNNY_SVG_TYPE_RULE = "Раздача: тип SVG";

/** Провайдер CDN хоста: от него зависят заголовок кэша и подсказки проверки. */
export type CdnProvider = "cloudflare" | "bunny";

/** Хост раздачи: адрес, хранилище за ним и как его CDN показывает кэш (ADR-0023, ADR-0025). */
export interface CdnHost {
  host: string;
  provider: CdnProvider;
  /** Хранилище за хостом — для отчётов. */
  storage: string;
  /** Заголовок с состоянием кэша CDN (строчными, как его отдаёт fetch). */
  cacheHeader: string;
  /** Состояния файла версии: ответ из кэша CDN или положен в него. */
  edgeCached: readonly string[];
  /** Состояния манифеста: CDN его не хранит. */
  edgeDirect: readonly string[];
  /** Начало заголовка Server: ответ пришёл от этого CDN, а не через чужой. */
  server: string;
}

export const R2_CDN: CdnHost = {
  host: CDN_HOST,
  provider: "cloudflare",
  storage: `бакет R2 ${R2_BUCKET}`,
  cacheHeader: "cf-cache-status",
  edgeCached: EDGE_CACHED,
  edgeDirect: EDGE_DIRECT,
  server: "cloudflare",
};

export const BUNNY_CDN: CdnHost = {
  host: CDN2_HOST,
  provider: "bunny",
  storage: `хранилище Bunny ${BUNNY_STORAGE_ZONE}`,
  cacheHeader: "cdn-cache",
  edgeCached: ["HIT", "MISS"],
  edgeDirect: ["BYPASS", "MISS"],
  server: "BunnyCDN",
};

/** Хосты раздачи в порядке выгрузки: основной, затем второй (ADR-0025). */
export const CDN_HOSTS: readonly CdnHost[] = [R2_CDN, BUNNY_CDN];
