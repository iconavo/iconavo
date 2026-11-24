// Готовит временную ветку для ревизии одной части кода (фаза 5) и возвращает всё как было.
// Запуск из корня репозитория:
//   node tools/review.mjs list            — части, файлы и строки
//   node tools/review.mjs prepare <часть> — временная ветка review/<часть>
//   node tools/review.mjs status          — идёт ли ревизия
//   node tools/review.mjs done            — вернуть main и убрать временное
//
// Зачем: /code-review и /security-review проверяют только изменения ветки относительно
// origin/HEAD. Чтобы они прочитали готовый код целиком, часть должна выглядеть добавленной
// заново: основа — main без исходников части, поверх — коммит с тем же деревом, что у main.
// Тесты остаются в основе: в проверку не попадают, но доступны для чтения.
// Рабочая папка не меняется, на GitHub ничего не уходит: ветку review/* не отправлять.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = "main";
const ORIGIN_HEAD = "refs/remotes/origin/HEAD";
const ORIGIN_MAIN = "refs/remotes/origin/main";
const BASE_REF = "refs/remotes/origin/review-base";
const BRANCH_PREFIX = "review/";

const CODE = /\.(ts|tsx|mjs|js|css|html|yml|yaml)$/;
const SKIP =
  /\.test\.|\.testing\.|\.stories\.|\/fixtures\/|package-lock\.json$|^apps\/site\/app\/globals\.css$/;

const SITE = "apps/site";
const PIPE = "packages/pipeline/src";
const lib = (...names) => names.map((name) => `${SITE}/lib/${name}.ts`);
const components = (...names) =>
  names.map((name) => `${SITE}/components/${name}`);
const pipe = (...names) => names.map((name) => `${PIPE}/${name}`);

// Порядок частей — порядок ревизии. security: нужна ли /security-review.
// level: уровень /code-review. extra — файлы вне правила расширений.
const PARTS = [
  {
    id: "1",
    title: "Ядро, тег, React и живые примеры",
    level: "high",
    security: true,
    paths: [
      "packages/core/src",
      "packages/icon/src",
      "packages/react/src",
      "examples/starters",
    ],
    extra: [
      "packages/core/package.json",
      "packages/icon/package.json",
      "packages/react/package.json",
    ],
  },
  {
    id: "2",
    title: "CI, робот обновления, настройки установки",
    level: "high",
    security: true,
    paths: [".github/workflows", ...pipe("update"), "pnpm-workspace.yaml"],
  },
  {
    id: "3",
    title: "Edge API и общий модуль поиска",
    level: "high",
    security: true,
    paths: ["apps/api/src", "packages/search/src"],
  },
  {
    id: "4",
    title: "MCP-сервер и общий модуль кода для вставки",
    level: "high",
    security: true,
    paths: ["apps/mcp/src", "packages/snippets/src"],
  },
  {
    id: "5",
    title: "Очистка SVG и сборка данных",
    level: "high",
    security: true,
    paths: pipe("sanitize", "svg", "normalize", "optimize", "build"),
  },
  {
    id: "6",
    title: "Сайт: каркас, адреса, заголовки, документация",
    level: "high",
    security: true,
    paths: [
      `${SITE}/app`,
      `${SITE}/next.config.ts`,
      ...components("shell", "ui", "home"),
      ...lib(
        "i18n",
        "headers",
        "theme",
        "docs",
        "page-path",
        "fonts",
        "cn",
        "slug",
        "markdown",
        "sidebar",
        "sidebar-motion",
        "scrollbars",
        "smooth-wheel",
        "menu",
        "metadata",
        "url-query",
      ),
    ],
    // Компоненты в корне components/, без подпапок.
    rootOf: `${SITE}/components`,
  },
  {
    id: "7",
    title: "Сайт: панель и страница иконки",
    level: "high",
    security: true,
    paths: [
      ...components("icon", "iconpage", "panel"),
      ...lib(
        "icon-page",
        "panel-code",
        "panel-anchor",
        "panel-fit",
        "panel-layout",
        "flip",
        "motion",
        "mockups",
        "names",
        "icon-settings",
        "icon-data",
        "code",
        "icon",
        "install",
        "install-readme",
      ),
    ],
  },
  {
    id: "8",
    title: "Сайт: рюкзак, настройки, копирование и скачивание",
    level: "high",
    security: true,
    paths: [
      ...components("bag", "settings"),
      ...lib(
        "panel-store",
        "bag",
        "bag-export",
        "bag-files",
        "zip",
        "prefs",
        "png",
        "clipboard",
        "download",
        "analytics",
        "grid-settings",
        "grid-script",
      ),
    ],
  },
  {
    id: "9",
    title: "Сайт: каталог и поиск",
    level: "high",
    security: false,
    paths: [
      ...components("pages", "catalog", "search"),
      ...lib(
        "catalog",
        "catalog-view",
        "icons",
        "api",
        "site-icons",
        "format",
        "iconavo",
        "grid-columns",
        "stable-callback",
        "search",
        "search-handoff",
        "filter-sheet",
        "selection",
      ),
    ],
  },
  {
    id: "10",
    title: "Раздача: сборка, выгрузка на два хоста, сверка",
    level: "high",
    security: true,
    paths: pipe("cdn"),
  },
  {
    id: "11",
    title: "Публикация в npm: пакеты данных и выпуск пакетов",
    level: "high",
    security: true,
    paths: pipe("npm", "release"),
  },
  {
    id: "12",
    title: "Сборка edge API и поисковый индекс",
    level: "high",
    security: true,
    paths: pipe("api", "meili"),
  },
  {
    id: "13",
    title: "Источники наборов, контроль качества, метаданные, журнал",
    level: "high",
    security: true,
    paths: [
      ...pipe("sources", "qc", "metadata", "changelog"),
      "packages/schema/src",
      "sources",
    ],
  },
  {
    id: "14",
    title: "Сборка и проверки MCP-сервера",
    level: "high",
    security: false,
    paths: pipe("mcp"),
  },
  {
    id: "15",
    title: "Инструменты: проверка сайта",
    level: "medium",
    security: false,
    paths: pipe("site"),
  },
  {
    id: "16",
    title: "Инструменты: песочница, пример Next.js, визуальное сравнение",
    level: "medium",
    security: false,
    paths: pipe("sandbox", "example", "visual", "icon"),
  },
  {
    id: "17",
    title: "Инструменты: живые примеры и команды конвейера",
    level: "medium",
    security: false,
    paths: pipe("starters", "report", "util", "cli.ts", "index.ts"),
  },
  {
    id: "18",
    title: "Инструменты: прототип поиска и замер качества",
    level: "medium",
    security: false,
    paths: pipe("search", "eval"),
  },
  {
    id: "19",
    title: "Инструменты: обогащение и эмбеддинги",
    level: "medium",
    security: false,
    paths: pipe("enrich", "embed"),
  },
];

function git(args, env) {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function stop(message) {
  console.error(`СТОП: ${message}`);
  process.exit(1);
}

function lines(output) {
  return output === "" ? [] : output.split("\n");
}

/** Файлы части в дереве main: исходники без тестов и подделок. */
function partFiles(part) {
  const listed = lines(
    git(["ls-tree", "-r", "--name-only", MAIN, "--", ...part.paths]),
  ).filter((file) => CODE.test(file) && !SKIP.test(file));
  const root = part.rootOf
    ? lines(git(["ls-tree", "--name-only", MAIN, `${part.rootOf}/`])).filter(
        (file) => CODE.test(file) && !SKIP.test(file),
      )
    : [];
  const extra = part.extra ?? [];
  for (const file of extra) {
    if (tryGit(["cat-file", "-e", `${MAIN}:${file}`]) === null) {
      stop(`в main нет файла ${file} (часть ${part.id})`);
    }
  }
  const all = [...new Set([...listed, ...root, ...extra])].sort();
  if (all.length === 0) stop(`в части ${part.id} нет файлов`);
  return all;
}

function countLines(files) {
  let total = 0;
  for (const file of files) {
    const text = git(["show", `${MAIN}:${file}`]);
    total += text === "" ? 0 : text.split("\n").length;
  }
  return total;
}

function findPart(id) {
  const part = PARTS.find((item) => item.id === id);
  if (!part) {
    stop(`нет части «${id}». Части: ${PARTS.map((p) => p.id).join(", ")}`);
  }
  return part;
}

function reviewBranches() {
  return lines(
    git([
      "for-each-ref",
      "--format=%(refname:short)",
      `refs/heads/${BRANCH_PREFIX}`,
    ]),
  );
}

function state() {
  return {
    branch: git(["branch", "--show-current"]),
    originHead: tryGit(["symbolic-ref", ORIGIN_HEAD]),
    base: tryGit(["rev-parse", "--verify", "--quiet", BASE_REF]),
    branches: reviewBranches(),
  };
}

function list() {
  let files = 0;
  let total = 0;
  console.log("Часть  Файлов  Строк  Проверка                   Название");
  for (const part of PARTS) {
    const own = partFiles(part);
    const count = countLines(own);
    files += own.length;
    total += count;
    const checks = `${part.level}${part.security ? " + безопасность" : ""}`;
    console.log(
      `${part.id.padStart(5)}  ${String(own.length).padStart(6)}  ${String(count).padStart(5)}  ${checks.padEnd(25)}  ${part.title}`,
    );
  }
  console.log(`Всего: ${files} файлов, ${total} строк.`);
}

function prepare(id) {
  const part = findPart(id);
  const now = state();
  if (git(["status", "--porcelain"]) !== "") {
    stop("в рабочей папке есть незакоммиченные изменения");
  }
  if (now.branch !== MAIN) stop(`текущая ветка — ${now.branch}, нужна ${MAIN}`);
  if (now.originHead !== ORIGIN_MAIN) {
    stop(
      `origin/HEAD указывает на ${now.originHead}, а не на origin/main: запустите done`,
    );
  }
  if (now.base !== null || now.branches.length > 0) {
    stop("прошлая ревизия не завершена: запустите done");
  }
  if (git(["rev-parse", MAIN]) !== git(["rev-parse", ORIGIN_MAIN])) {
    console.warn(
      "Внимание: main отличается от origin/main — ревизия пойдёт по локальному main.",
    );
  }

  const files = partFiles(part);
  const dir = mkdtempSync(join(tmpdir(), "iconavo-review-"));
  const branch = `${BRANCH_PREFIX}${part.id}`;
  try {
    const index = { GIT_INDEX_FILE: join(dir, "index") };
    const listFile = join(dir, "files.txt");
    writeFileSync(listFile, `${files.join("\n")}\n`);
    git(["read-tree", MAIN], index);
    git(["rm", "-q", "--cached", `--pathspec-from-file=${listFile}`], index);
    const baseTree = git(["write-tree"], index);
    const base = git([
      "commit-tree",
      baseTree,
      "-p",
      MAIN,
      "-m",
      `Ревизия: основа без части ${part.id} (временный коммит, не для слияния)`,
    ]);
    const review = git([
      "commit-tree",
      `${MAIN}^{tree}`,
      "-p",
      base,
      "-m",
      `Ревизия: часть ${part.id} целиком — ${part.title} (временный коммит, не для слияния)`,
    ]);
    git(["update-ref", BASE_REF, base]);
    git(["branch", branch, review]);
    git(["switch", "-q", branch]);
    git(["symbolic-ref", ORIGIN_HEAD, BASE_REF]);
  } catch (error) {
    console.error(String(error.stderr ?? error.message ?? error));
    restore();
    stop("не удалось подготовить ветку, всё возвращено как было");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const seen = lines(git(["diff", "--name-only", "origin/HEAD...HEAD"]));
  const stat = lines(git(["diff", "--numstat", "origin/HEAD...HEAD"]));
  // git пишет «-» вместо чисел у файлов, которые считает двоичными (например, с байтом NUL).
  const binary = stat
    .filter((row) => row.startsWith("-\t-\t"))
    .map((row) => row.split("\t")[2]);
  const numeric = stat.filter((row) => !row.startsWith("-\t-\t"));
  const added = numeric.reduce(
    (sum, row) => sum + Number(row.split("\t")[0]),
    0,
  );
  const removed = numeric.reduce(
    (sum, row) => sum + Number(row.split("\t")[1]),
    0,
  );
  if (binary.length > 0) {
    console.warn(
      `Внимание: git считает двоичными (в diff нет текста, ревизии читать их целиком): ${binary.join(", ")}`,
    );
  }
  if (seen.length !== files.length || removed !== 0) {
    restore();
    stop(
      `ревизия увидела бы ${seen.length} файлов из ${files.length}, удалённых строк ${removed}: всё возвращено`,
    );
  }
  if (git(["status", "--porcelain"]) !== "") {
    restore();
    stop("рабочая папка изменилась при переключении: всё возвращено");
  }
  console.log(`Часть ${part.id}: ${part.title}`);
  console.log(
    `Ветка ${branch}: ревизия видит ${seen.length} файлов, ${added} строк.`,
  );
  console.log(`Дальше: /code-review ${part.level} --max-findings all`);
  if (part.security) console.log("Затем:  /security-review");
  console.log("После ревизии: node tools/review.mjs done");
}

function restore() {
  const now = state();
  if (now.branch.startsWith(BRANCH_PREFIX) || now.branch === "") {
    git(["switch", "-q", MAIN]);
  }
  git(["symbolic-ref", ORIGIN_HEAD, ORIGIN_MAIN]);
  if (now.base !== null) git(["update-ref", "-d", BASE_REF]);
  for (const branch of now.branches) git(["branch", "-q", "-D", branch]);
}

function status() {
  const now = state();
  const active =
    now.base !== null ||
    now.branches.length > 0 ||
    now.originHead !== ORIGIN_MAIN;
  console.log(`Ветка: ${now.branch}`);
  console.log(`origin/HEAD → ${now.originHead}`);
  console.log(
    active
      ? `Идёт ревизия: ${now.branches.join(", ") || "ветки нет"}. Завершить: done`
      : "Ревизия не идёт, всё как обычно.",
  );
  return active;
}

function done() {
  if (git(["status", "--porcelain"]) !== "") {
    stop(
      "в рабочей папке есть изменения: исправления делаются в отдельной ветке от main, не в review/*",
    );
  }
  restore();
  status();
}

const [command, arg] = process.argv.slice(2);
// Скрипт запускают из корня репозитория: проверяем, что это он.
try {
  if (JSON.parse(readFileSync("package.json", "utf8")).name === undefined) {
    throw new Error("нет имени");
  }
  git(["rev-parse", "--show-toplevel"]);
} catch {
  stop("запускайте из корня репозитория");
}
if (command === "list") list();
else if (command === "prepare" && arg) prepare(arg);
else if (command === "status") status();
else if (command === "done") done();
else {
  console.error(
    "Запуск: node tools/review.mjs list | prepare <часть> | status | done",
  );
  process.exit(2);
}
