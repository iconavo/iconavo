// Настройки пакетов данных в npm (ADR-0026, шаг 5 фазы 2): имена пакетов, тег, правила версий
// (ADR-0005), реестр, репозиторий и workflow, из которых пакеты выходят с подписью provenance, и
// пределы ожидания проверки после публикации.

/** Папка пакетов в корне репозитория; в git не попадает. */
export const NPM_OUT_DIR = "dist-npm";
/** План для CI: какие пакеты публиковать и с какими версиями — в корне папки пакетов. */
export const NPM_PLAN_FILE = "plan.json";
/** Scope в npm (ADR-0029): @iconavo занято. */
export const NPM_SCOPE = "@iconavo-ui";
/** Пакет набора: один набор — один пакет, как у Iconify (ADR-0026). */
export const npmPackageName = (id: string) => `${NPM_SCOPE}/icons-${id}`;
/** Тег версий до запуска (ADR-0026); в день запуска — "latest". Тег входит в отпечаток пакета. */
export const NPM_TAG = "next";
/** Первая версия нового пакета: формат устоялся, имена не пропадают (решение владельца 23 октября 2026). */
export const NPM_FIRST_VERSION = "1.0.0";
/** Первая цифра версии — версия формата пакета: растёт только при смене формата (ADR-0005). */
export const NPM_FORMAT_MAJOR = 1;
/** Реестр npm: описания пакетов и архивы версий. */
export const NPM_REGISTRY = "https://registry.npmjs.org";
/** Страница пакета для людей — в отчётах. */
export const npmPage = (name: string) =>
  `https://www.npmjs.com/package/${name}`;
/** Репозиторий: адрес в package.json сверяется с подписью provenance, поэтому он точный. */
export const NPM_REPOSITORY = "https://github.com/iconavo/iconavo";
export const NPM_REPOSITORY_URL = "git+https://github.com/iconavo/iconavo.git";
export const NPM_BUGS_URL = "https://github.com/iconavo/iconavo/issues";
/** Страница набора на сайте — homepage пакета; лента выпусков набора — ссылка в README (ADR-0026, ADR-0037). */
export const npmSetPage = (id: string) => `https://iconavo.dev/${id}`;
export const npmChangelogPage = (id: string) =>
  `https://iconavo.dev/changelog?set=${id}`;
/** Workflow и ветка, из которых выходят пакеты: так настроена доверенная публикация на npmjs.com. */
export const NPM_WORKFLOW = ".github/workflows/publish.yml";
export const NPM_PUBLISH_REF = "refs/heads/main";
/** Тип подписи provenance, которую npm ставит при публикации из CI. */
export const NPM_PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
/** Ожидание одного ответа реестра и число попыток; паузы между ними — как у Polza (embed/config.ts). */
export const NPM_TIMEOUT_MS = 60_000;
export const NPM_MAX_ATTEMPTS = 5;
/** Пределы распаковки архива опубликованной версии: icons.json Material Symbols — около 9,3 МБ. */
export const NPM_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const NPM_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
/** Проверка после публикации: как часто спрашивать реестр, пока он не покажет новую версию. */
export const NPM_POLL_MS = 20_000;
/** Сколько новых имён перечисляет отчёт. */
export const NPM_NAMES_LIMIT = 20;
