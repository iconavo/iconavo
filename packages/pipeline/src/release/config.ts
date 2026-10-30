// Выпуск пакетов для разработчиков (ADR-0051, шаг 11 фазы 3): ядро, тег и React выходят одной версией
// (ADR-0029) из CI с provenance, до запуска — под тегом next (ADR-0026, ADR-0036). Здесь — файлы,
// которые меняет выпуск, workflow, к которому привязана доверенная публикация, и поля package.json,
// которые сверяет подготовка.

import {
  NPM_BUGS_URL,
  NPM_REPOSITORY_URL,
  NPM_SCOPE,
  NPM_TAG,
} from "../npm/config.js";
import { PACKAGES, type PackageId } from "../starters/config.js";

export { PACKAGES, type PackageId };

/** Имя пакета в npm. */
export const packageName = (id: PackageId) => `${NPM_SCOPE}/${id}`;

/** Архивы пакетов и план для CI — в корне репозитория, не в git. */
export const RELEASE_OUT_DIR = "dist-release";
export const RELEASE_PLAN_FILE = "plan.json";

/**
 * Workflow, из которого выходят пакеты: к нему и окружению npm привязана доверенная публикация на
 * npmjs.com, его же путь записан в подписи provenance. Не переименовывать.
 */
export const RELEASE_WORKFLOW = ".github/workflows/release.yml";

/** Журнал изменений трёх пакетов — один, рядом с README тега; на сайте — /docs/changelog. */
export const CHANGELOG_FILE = "packages/icon/CHANGELOG.md";

/** Файлы со строкой подключения скрипта тега: адрес jsDelivr с версией и хэш integrity. */
export const SCRIPT_LINE_FILES = [
  "packages/icon/README.md",
  "examples/starters/html/index.html",
  "README.md",
] as const;

/** Примеры, которые ставят пакеты из npm: версию им ставит выпуск, lock-файлы — после публикации. */
export const STARTER_DIRS = [
  "examples/starters/react",
  "examples/starters/next",
] as const;

/** Скрипт тега для страниц без сборщика в архиве пакета тега. */
export const SCRIPT_PATH = "dist/iconavo-icon.js";

/** Адрес скрипта на jsDelivr: по точной версии файл не меняется никогда (ADR-0032). */
export const scriptUrl = (version: string) =>
  `https://cdn.jsdelivr.net/npm/@iconavo-ui/icon@${version}/${SCRIPT_PATH}`;

/** До запуска — только 0.x: 1.0 выходит в день запуска (ADR-0005). */
export const RELEASE_MAJOR = 0;

/** Номер вида X.Y.Z без ведущих нулей. */
export const VERSION_FORMAT =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** Версия без выпуска: пакеты ещё ни разу не выходили. */
export const UNRELEASED = "0.0.0";

/** Страница пакетов на npm — документация на сайте (ADR-0050). */
export const HOMEPAGE = "https://iconavo.dev/docs";

/** Поля package.json, одинаковые у трёх пакетов, кроме адреса папки; их сверяет подготовка. */
export const fixedFields = (id: PackageId) => ({
  license: "MIT",
  homepage: HOMEPAGE,
  bugs: { url: NPM_BUGS_URL },
  repository: {
    type: "git",
    url: NPM_REPOSITORY_URL,
    directory: `packages/${id}`,
  },
  type: "module",
  files: ["dist"],
  publishConfig: { access: "public", provenance: true, tag: NPM_TAG },
});

/** Скрипты, которые npm запускает сам при установке или упаковке: у наших пакетов их нет. */
export const LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "preprepare",
  "postprepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
];

/** Чистый проект после публикации: пустая папка, пакеты из npm и React этой версии. */
export const CLEAN_DIR = ".cache/release/clean";
export const CLEAN_REACT = "19.3.1";
/** Иконка, которую рисует чистый проект; её рисунок сверяется с data/. */
export const CLEAN_ICON = "lucide:house";
/** npm install чистого проекта сразу после публикации: попытки и пауза между ними. */
export const CLEAN_ATTEMPTS = 4;
export const CLEAN_RETRY_MS = 30_000;

/** jsDelivr берёт новую версию из npm не сразу: сколько ждать и как часто спрашивать. */
export const JSDELIVR_POLL_MS = 20_000;
