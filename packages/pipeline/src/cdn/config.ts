// Настройки сборки раздачи (ADR-0022): имена папок и файлов, параллельность записи, пределы отчёта.

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
/** Одновременных записей в бакет: общего лимита запросов у R2 нет, предел — одна запись в секунду в один ключ. */
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
