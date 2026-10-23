// Команды конвейера: pnpm sources fetch [id…] | pnpm sources pin <id> [версия|коммит] | pnpm sanitize [id…]
// | pnpm normalize [id…] | pnpm data [id…] [--accept-changes] | pnpm pr <id> [--run-url=… …] [--no-auto-merge]
// | pnpm enrich [id…] [--limit=N] [--max-cost=USD] [--dry-run] [--no-wait]
// | pnpm embed [id…] [--model=…] [--max-rub=N] [--dry-run] | pnpm nearest [запрос…] [--model=…]
// | pnpm judge [--limit=N] [--max-rub=N] [--dry-run] | pnpm eval [--model=…] [--baseline]
// | pnpm search-page [--port=N] [--model=…] | pnpm cdn build | pnpm cdn upload [--dry-run]
// | pnpm cdn verify | pnpm cdn check | pnpm packages prepare [id…] [--new] [--force]
// | pnpm packages verify [id…] [--wait=N] [--plan=…] | pnpm api build | pnpm api preview [--port=N]
// | pnpm api check [--expect-build=…]
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApi } from "./api/build.js";
import { type ApiCheckReport, apiCheckFailed, checkApi } from "./api/check.js";
import {
  formatApiCheckSummary,
  formatApiCheckTable,
} from "./api/check-report.js";
import {
  API_HOST,
  API_OUT_DIR,
  PREVIEW_PORT,
  WORKER_FILE,
} from "./api/config.js";
import { startApiPreview } from "./api/preview.js";
import { canonicalJson } from "./build/json.js";
import { formatBuildReport, renderBuildGallery } from "./build/report.js";
import { buildSet, type SetBuildReport, writeSetData } from "./build/run.js";
import { bunnyClient } from "./cdn/bunny.js";
import {
  type CheckReport,
  checkCdn,
  checkFailed,
  compareHostManifests,
} from "./cdn/check.js";
import {
  formatCheckSummary,
  formatCheckTable,
  formatCheckTotal,
} from "./cdn/check-report.js";
import {
  BUNNY_ENV,
  BUNNY_STORAGE_ZONE,
  CDN_HOSTS,
  type CdnProvider,
  OUT_DIR,
  R2_BUCKET,
  R2_ENV,
} from "./cdn/config.js";
import {
  formatCdnReport,
  formatCdnSummary,
  formatCdnTable,
  renderCdnPage,
} from "./cdn/report.js";
import { buildCdn, cdnStop } from "./cdn/run.js";
import { r2Client } from "./cdn/s3.js";
import type { StorageClient } from "./cdn/storage.js";
import { uploadCdn, uploadStop, verifyFailed } from "./cdn/upload.js";
import {
  formatHostTitle,
  formatUploadReport,
  formatUploadSummary,
  formatUploadTable,
  formatVerifyVerdict,
  renderUploadPage,
} from "./cdn/upload-report.js";
import { polzaEmbeddingClient } from "./embed/client.js";
import {
  DEFAULT_MAX_RUB,
  type EmbeddingModel,
  MODELS,
  NEAREST_PAIRS,
} from "./embed/config.js";
import { nearestQueries, nearestStop } from "./embed/nearest.js";
import {
  formatEmbedReport,
  formatEmbedTable,
  formatNearest,
  renderEmbedPage,
  renderNearestPage,
} from "./embed/report.js";
import { embedSets, embedStatus, hasStop, loadTexts } from "./embed/run.js";
import { DEFAULT_MAX_COST } from "./enrich/config.js";
import {
  formatEnrichReport,
  formatEnrichTable,
  renderEnrichPage,
} from "./enrich/report.js";
import { countBases, enrichSets } from "./enrich/run.js";
import { polzaChatClient } from "./eval/client.js";
import { DEFAULT_MAX_RUB as JUDGE_MAX_RUB } from "./eval/config.js";
import { readOverrides } from "./eval/golden.js";
import { judgeEval, judgeStop } from "./eval/judge.js";
import {
  baselineJson,
  formatEvalReport,
  formatJudgeReport,
  renderEvalPage,
  renderJudgePage,
} from "./eval/report.js";
import { evalStop, evaluate } from "./eval/run.js";
import { formatMetadataTable } from "./metadata/report.js";
import { formatNormalizeReport, renderGallery } from "./normalize/gallery.js";
import { normalizeSet, type SetNormalizeReport } from "./normalize/run.js";
import { NPM_OUT_DIR } from "./npm/config.js";
import { preparePackages, prepareStop } from "./npm/prepare.js";
import { registryClient } from "./npm/registry.js";
import {
  formatNpmVerdict,
  formatNpmVerifyEntry,
  formatNpmVerifyTable,
  formatPrepareReport,
  formatPrepareSummary,
  formatPrepareTable,
  renderNpmVerifyPage,
  renderPreparePage,
} from "./npm/report.js";
import { npmVerifyFailed, readPlan, verifyPackages } from "./npm/verify.js";
import { gitHistory, loadBaseline } from "./qc/baseline.js";
import {
  formatFixtures,
  formatSanitizeReport,
  renderSanitizeHtml,
} from "./sanitize/report.js";
import {
  type SetSanitizeReport,
  sanitizeFixtures,
  sanitizeSet,
} from "./sanitize/run.js";
import { loadCatalog } from "./search/catalog.js";
import { MODEL_SEARCH, PAGE_PORT } from "./search/config.js";
import { startSearchServer } from "./search/server.js";
import { buildTextIndex } from "./search/text.js";
import { loadModelVectors, type ModelVectors } from "./search/vectors.js";
import {
  cachedSourceDir,
  fetchSource,
  pinEntry,
  sourceLabel,
} from "./sources/fetch.js";
import {
  baseRevision,
  gitShow,
  releaseTagsByCommit,
  remoteTags,
} from "./sources/git.js";
import { lockFileSchema, readLock, writeLock } from "./sources/lock.js";
import { loadRegistry } from "./sources/registry.js";
import { fetchStop, formatBytes, formatReport } from "./sources/report.js";
import { type PrLinks, prText } from "./update/pr.js";
import {
  buildSummarySchema,
  type SetSummary,
  SUMMARY_FILE,
  setSummary,
  summaryText,
} from "./update/summary.js";

const USAGE = `Использование:
  pnpm sources fetch [id…]            скачать все наборы или указанные
  pnpm sources pin <id> [версия|коммит]   закрепить версию (по умолчанию последнюю)
  pnpm sanitize [id…]                 очистить SVG скачанных наборов и показать отчёт
  pnpm normalize [id…]                нормализовать иконки и собрать галерею
  pnpm data [id…]                     собрать наборы в data/{набор}/: icons.json (SVGO, алиасы,
                                      контроль качества, скрытые иконки), info.json, metadata.json,
                                      search.json, LICENSE, changelog.json и CHANGELOG.md; галерея,
                                      страницы qc.html, metadata.html и changelog.html
  pnpm data [id…] --accept-changes    то же, но изменения иконок без новой версии источника
                                      приняты: вы проверили их в отчёте qc.html. Сравнение идёт
                                      с версией в main: на ветке флаг нужен до слияния
  pnpm pr <id>                        решение и текст PR робота обновления по сводке последней
                                      сборки (summary.json): .cache/update/{id}/pr.json и body.md
      --run-url=… --changelog-url=… --qc-url=… --metadata-url=… --reports-url=…
                                      ссылки на запуск и отчёты в описании PR (https://)
      --no-auto-merge                 не включать автослияние: PR ждёт владельца
  pnpm enrich [id…]                   описания и синонимы ru/en для базовых иконок без описаний:
                                      PNG → Claude (Message Batches) → data/{набор}/search.json;
                                      нужен ANTHROPIC_API_KEY в .env; отчёт .cache/reports/enrich/
      --limit=N                       постоянная случайная выборка из N базовых иконок: повторный
                                      запуск с тем же N ничего не отправляет
      --max-cost=USD                  лимит стоимости прогона (по умолчанию $${DEFAULT_MAX_COST}): оценка выше —
                                      ничего не отправляется
      --dry-run                       только посчитать и оценить стоимость, ничего не отправлять
      --no-wait                       отправить пакет и выйти; результаты заберёт следующий запуск
  pnpm embed [id…]                    векторы смысла для базовых иконок с описаниями тремя моделями
                                      через Polza AI → .cache/embeddings/{модель}/; кэш по хэшу
                                      текста; нужен POLZA_API_KEY в .env; отчёт .cache/reports/embed/
      ${`--model=${MODELS.map((m) => m.key).join("|")}`.padEnd(32)}только эта модель (флаг можно повторить)
      --max-rub=N                     лимит стоимости прогона в рублях (по умолчанию ${DEFAULT_MAX_RUB}): оценка
                                      выше — ничего не отправляется
      --dry-run                       только посчитать и оценить стоимость, ничего не отправлять
  pnpm nearest [запрос…]              ближайшие по смыслу иконки к запросам по каждой модели;
                                      без запросов — пары ru/en из конфига; запросы сравниваются
                                      парами; страница .cache/reports/embed/nearest.html
      --model=…                       только эта модель (флаг можно повторить)
  pnpm judge                          разметка эталона ИИ-судьёй: всё неразмеченное в первых
                                      десятках вариантов замера → docs/eval/judgments.json; нужен
                                      POLZA_API_KEY; страница .cache/reports/eval/judge.html
      --limit=N                       пилот: N запросов, по ячейкам «язык × тип»
      --max-rub=N                     лимит стоимости запуска в рублях (по умолчанию ${JUDGE_MAX_RUB})
      --dry-run                       только посчитать пары и оценить стоимость
  pnpm eval                           замер поиска по эталону: Hit@5, MRR@10, P@5 по моделям,
                                      языкам и частям; страница .cache/reports/eval/index.html
      --model=…                       только эта модель (флаг можно повторить)
      --baseline                      записать docs/eval/baseline.json — итог для фазы 2
  pnpm search-page                    страница поиска для ручной проверки на 127.0.0.1;
                                      там же отчёты из .cache/reports
      --port=N                        порт (по умолчанию ${PAGE_PORT})
      --model=…                       только эта модель — меньше памяти (флаг можно повторить)
  pnpm cdn build                      папка раздачи dist-cdn/ из data/ (ADR-0022): на каждую иконку
                                      и алиас v/{версия}/{набор}/{имя}.json и .svg, контрольные суммы
                                      v/{версия}/{набор}.checksums.json и manifest.json; без изменений
                                      ничего не перезаписывает; отчёт .cache/reports/cdn/
  pnpm cdn upload                     собрать раздачу и выгрузить недостающие файлы на оба хоста —
                                      бакет R2 (cdn.iconavo.dev), затем хранилище Bunny
                                      (cdn2.iconavo.dev), ADR-0022, ADR-0025: файл сумм набора —
                                      последним, сверка по списку; манифесты — в конце, когда файлы
                                      есть на обоих хостах, и только при отличии; в v/ ничего не
                                      перезаписывается и не удаляется; нужны R2_ACCOUNT_ID,
                                      R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY и BUNNY_STORAGE_PASSWORD
                                      в .env; отчёт .cache/reports/cdn/upload.html
      --dry-run                       только сравнить с хранилищами и показать, что будет выгружено
  pnpm cdn verify                     сверка хостов: сравнить оба хранилища со сборкой, ничего не
                                      записывая; код 1, если чего-то недостаёт или что-то отличается;
                                      ключи те же; отчёт .cache/reports/cdn/verify.html
  pnpm cdn check                      проверить живые адреса обоих хостов (ADR-0023, ADR-0025):
                                      манифест, файл сумм, lucide:heart (.json и .svg) и ответ 404 —
                                      тип, кэш браузера и CDN, CORS, защита, сжатие br и gzip,
                                      содержимое; затем — что манифесты хостов совпадают; и edge API
                                      (pnpm api check); ключи не нужны
  pnpm api build                      собрать функцию edge API (ADR-0024) в ${API_OUT_DIR}/: ${WORKER_FILE} — один
                                      модуль для Cloudflare Workers, metadata.json — тело запроса
                                      загрузки, build.json — метка сборки; без изменений ничего не пишет
  pnpm api preview                    превью функции на 127.0.0.1 с данными из dist-cdn/ и страница
                                      для глаз: SVG с параметрами, CSS, пачка, ошибки
      --port=N                        порт (по умолчанию ${PREVIEW_PORT})
  pnpm api check                      проверить живой https://${API_HOST}: ответы сходятся со
                                      статикой той же версии, повтор — из кэша, заголовки, сжатие
      --expect-build=…                ждать и проверять эту сборку (после выкладки в CI)
  pnpm packages prepare [id…]         пакеты npm @iconavo-ui/icons-{набор} в ${NPM_OUT_DIR}/ (ADR-0026):
                                      данные, LICENSE, README, типы; версия — по реестру npm (только
                                      чтение, ключи не нужны); план для CI ${NPM_OUT_DIR}/plan.json;
                                      сама ничего не публикует; отчёт .cache/reports/npm/index.html
      --new                           новый пакет тоже: первая версия (ручной запуск в CI)
      --force                         новая патч-версия даже без изменений
  pnpm packages verify [id…]          проверка по реестру npm: под тегом — версия с отпечатком сборки
                                      из data/, файлы те же, provenance из main, доверенная
                                      публикация; отчёт .cache/reports/npm/verify.html
      --wait=N                        ждать до N секунд, пока реестр покажет новую версию и её подпись
      --plan=…                        план подготовки (dist-npm/plan.json): ждать ровно выпущенные версии`;

/** Флаги pnpm pr со ссылками: флаг → поле PrLinks. */
const LINK_FLAGS: Record<string, keyof PrLinks> = {
  "--run-url": "run",
  "--changelog-url": "changelog",
  "--qc-url": "qc",
  "--metadata-url": "metadata",
  "--reports-url": "reports",
};

// packages/pipeline/dist/cli.js -> корень репозитория
const root = fileURLToPath(new URL("../../../", import.meta.url));
const lockPath = join(root, "sources.lock.json");
const cacheDir = join(root, ".cache", "sources");
const dataDir = join(root, "data");
const reportsDir = join(root, ".cache", "reports");
const distCdnDir = join(root, "dist-cdn");
const distNpmDir = join(root, NPM_OUT_DIR);
const distApiDir = join(root, API_OUT_DIR);
const embeddingsDir = join(root, ".cache", "embeddings");
const evalDir = join(root, "docs", "eval");
const queriesPath = join(evalDir, "queries.csv");
const judgmentsPath = join(evalDir, "judgments.json");
const overridesPath = join(evalDir, "overrides.json");
const queryDir = join(root, ".cache", "search", "queries");
const fixturesDir = join(
  root,
  "packages",
  "pipeline",
  "fixtures",
  "harmful-svg",
);

const [command, ...params] = process.argv.slice(2);
// Флаги отдельно от остальных слов — имён наборов, а у nearest запросов: иначе «--accept-changes»
// искали бы как набор.
const flags = params.filter((a) => a.startsWith("--"));
const args = params.filter((a) => !a.startsWith("--"));

/** JSON-файл или undefined, если файла нет или он не читается: так берётся журнал из data/. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function usageError(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

/** Таблица и итог проверки edge API. */
function printApiCheck(report: ApiCheckReport) {
  console.log("");
  console.log(formatApiCheckTable(report));
  for (const line of formatApiCheckSummary(report)) console.log(line);
}

// У каждой команды свои флаги; ссылки pnpm pr — в виде --флаг=https://…
const links: PrLinks = {};
let limit: number | undefined;
let maxCost = DEFAULT_MAX_COST;
let maxRub = DEFAULT_MAX_RUB;
let judgeMaxRub = JUDGE_MAX_RUB;
let port = command === "api" ? PREVIEW_PORT : PAGE_PORT;
let waitSeconds = 0;
let planPath: string | undefined;
let expectBuild: string | undefined;
const modelKeys = new Set<string>();
for (const flag of flags) {
  const eq = flag.indexOf("=");
  const name = eq === -1 ? flag : flag.slice(0, eq);
  const value = eq === -1 ? undefined : flag.slice(eq + 1);
  const link = LINK_FLAGS[name];
  if (command === "data" && flag === "--accept-changes") continue;
  if (command === "pr" && flag === "--no-auto-merge") continue;
  if (command === "pr" && link && value?.startsWith("https://")) {
    links[link] = value;
    continue;
  }
  if (command === "enrich") {
    if (flag === "--dry-run" || flag === "--no-wait") continue;
    if (name === "--limit" && /^[1-9][0-9]*$/.test(value ?? "")) {
      limit = Number(value);
      continue;
    }
    if (name === "--max-cost" && /^[0-9]+(\.[0-9]+)?$/.test(value ?? "")) {
      maxCost = Number(value);
      continue;
    }
  }
  if (command === "judge") {
    if (flag === "--dry-run") continue;
    if (name === "--limit" && /^[1-9][0-9]*$/.test(value ?? "")) {
      limit = Number(value);
      continue;
    }
    if (name === "--max-rub" && /^[0-9]+(\.[0-9]+)?$/.test(value ?? "")) {
      judgeMaxRub = Number(value);
      continue;
    }
  }
  if (command === "eval" && flag === "--baseline") continue;
  if (command === "cdn" && flag === "--dry-run") continue;
  if (command === "packages") {
    if (flag === "--new" || flag === "--force") continue;
    if (name === "--plan" && value !== undefined && value !== "") {
      planPath = value;
      continue;
    }
    if (name === "--wait" && /^(0|[1-9][0-9]{0,4})$/.test(value ?? "")) {
      waitSeconds = Number(value);
      continue;
    }
  }
  if (
    (command === "search-page" || command === "api") &&
    name === "--port" &&
    /^[1-9][0-9]{3,4}$/.test(value ?? "") &&
    Number(value) <= 65535
  ) {
    port = Number(value);
    continue;
  }
  if (
    command === "api" &&
    name === "--expect-build" &&
    /^[0-9a-f]{8}$/.test(value ?? "")
  ) {
    expectBuild = value;
    continue;
  }
  if (
    command === "embed" ||
    command === "nearest" ||
    command === "eval" ||
    command === "search-page"
  ) {
    if (name === "--model" && value !== undefined) {
      if (!MODELS.some((m) => m.key === value)) {
        usageError(
          `Модель «${value}» не найдена. Есть: ${MODELS.map((m) => m.key).join(", ")}.`,
        );
      }
      modelKeys.add(value);
      continue;
    }
    if (command === "embed" && flag === "--dry-run") continue;
    if (
      command === "embed" &&
      name === "--max-rub" &&
      /^[0-9]+(\.[0-9]+)?$/.test(value ?? "")
    ) {
      maxRub = Number(value);
      continue;
    }
  }
  usageError(`Неизвестный флаг «${flag}».`);
}
const acceptChanges = flags.includes("--accept-changes");
// Модели эмбеддингов в порядке конфига; без --model — все.
const models: readonly EmbeddingModel[] =
  modelKeys.size > 0 ? MODELS.filter((m) => modelKeys.has(m.key)) : MODELS;

try {
  const configs = await loadRegistry(join(root, "sources"));
  const pick = (ids: string[]) => {
    for (const id of ids) {
      if (!configs.some((c) => c.id === id)) {
        usageError(
          `Набор «${id}» не найден. Есть: ${configs.map((c) => c.id).join(", ")}.`,
        );
      }
    }
    return ids.length ? configs.filter((c) => ids.includes(c.id)) : configs;
  };

  if (command === "fetch") {
    let lock = await readLock(lockPath);
    let failed = 0;
    for (const config of pick(args)) {
      try {
        const result = await fetchSource(config, lock, { cacheDir });
        lock = result.lock;
        await writeLock(lockPath, lock); // сохраняем сразу: следующий набор может упасть
        console.log(`${formatReport(result.report)}\n`);
        // Имена не по правилу или конфликт имён: собирать набор нельзя (ADR-0001) — код выхода 1.
        if (fetchStop(result.report).length > 0) failed++;
      } catch (e) {
        failed++;
        console.error(`${config.id}: ошибка — ${(e as Error).message}\n`);
      }
    }
    process.exit(failed > 0 ? 1 : 0);
  } else if (command === "pin") {
    const [id, requested, ...rest] = args;
    if (!id || rest.length > 0) usageError("Нужно указать набор.");
    const [config] = pick([id]);
    if (!config) usageError(`Набор «${id}» не найден.`);
    const lock = await readLock(lockPath);
    const entry = await pinEntry(config, requested);
    await writeLock(lockPath, { ...lock, [config.id]: entry });
    const value = entry.type === "npm" ? entry.version : entry.commit;
    console.log(
      `${config.id}: закреплено ${value}. Скачайте: pnpm sources fetch ${config.id}`,
    );
  } else if (command === "sanitize") {
    const lock = await readLock(lockPath);
    const reports: SetSanitizeReport[] = [];
    let failed = 0;
    for (const config of pick(args)) {
      try {
        const { dir, entry } = await cachedSourceDir(config, lock, cacheDir);
        const report = await sanitizeSet(
          config,
          dir,
          sourceLabel(config, entry),
        );
        reports.push(report);
        if (report.stop.length > 0) failed++;
        console.log(`${formatSanitizeReport(report)}\n`);
      } catch (e) {
        failed++;
        console.error(`${config.id}: ошибка — ${(e as Error).message}\n`);
      }
    }
    const fixtures = await sanitizeFixtures(fixturesDir);
    console.log(`${formatFixtures(fixtures)}\n`);
    const total = reports.reduce((n, r) => n + r.total, 0);
    const cleaned = reports.reduce((n, r) => n + r.cleaned, 0);
    const excluded = reports.reduce((n, r) => n + r.excluded.length, 0);
    console.log(
      `Итого: ${total} иконок · очищено ${cleaned} · исключено ${excluded} · остановлено наборов: ${failed}`,
    );
    await mkdir(reportsDir, { recursive: true });
    const htmlPath = join(reportsDir, "sanitize.html");
    await writeFile(htmlPath, renderSanitizeHtml(reports, fixtures), "utf8");
    console.log(`Отчёт с картинками: ${htmlPath}`);
    process.exit(failed > 0 ? 1 : 0);
  } else if (command === "normalize") {
    const lock = await readLock(lockPath);
    const reports: SetNormalizeReport[] = [];
    let failed = 0;
    for (const config of pick(args)) {
      try {
        const { dir, entry } = await cachedSourceDir(config, lock, cacheDir);
        const report = await normalizeSet(
          config,
          dir,
          sourceLabel(config, entry),
        );
        reports.push(report);
        if (report.stop.length > 0) failed++;
        console.log(`${formatNormalizeReport(report)}\n`);
      } catch (e) {
        failed++;
        console.error(`${config.id}: ошибка — ${(e as Error).message}\n`);
      }
    }
    const total = reports.reduce((n, r) => n + r.total, 0);
    const excluded = reports.reduce((n, r) => n + r.excluded.length, 0);
    console.log(
      `Итого: ${total} иконок · нормализовано ${total - excluded} · исключено ${excluded} · остановлено наборов: ${failed}`,
    );
    // Старые страницы удаляются: число страниц могло измениться.
    const galleryDir = join(reportsDir, "normalize");
    await rm(galleryDir, { recursive: true, force: true });
    await mkdir(galleryDir, { recursive: true });
    let files = 0;
    for (const file of renderGallery(reports)) {
      await writeFile(join(galleryDir, file.name), file.html, "utf8");
      files++;
    }
    console.log(
      `Галерея (файлов: ${files}): ${join(galleryDir, "index.html")}`,
    );
    process.exit(failed > 0 ? 1 : 0);
  } else if (command === "data") {
    const lock = await readLock(lockPath);
    // Прошлая версия — версия набора в main (ADR-0016, ADR-0018): все изменения ветки попадают в один
    // выпуск журнала. Git недоступен — прошлая версия не прочитается, и наборы остановятся.
    const base = await baseRevision(root).catch((e: Error) => ({
      commit: "HEAD",
      label: `git недоступен — ${e.message}`,
    }));
    console.log(`Прошлая версия наборов: ${base.label}
`);
    const history = gitHistory(root, base.commit);
    // Одно время на весь запуск — дата новых выпусков журнала.
    const now = Math.floor(Date.now() / 1000);
    const reports: SetBuildReport[] = [];
    // Сводка для робота обновления (ADR-0019); наборы, которые не собрались вовсе, — отдельно.
    const summaries: SetSummary[] = [];
    const errors: { id: string; message: string }[] = [];
    let failed = 0;
    for (const config of pick(args)) {
      try {
        const { dir, entry } = await cachedSourceDir(config, lock, cacheDir);
        const started = performance.now();
        const previous = await loadBaseline(history, config, entry);
        const report = await buildSet(config, dir, entry, {
          ...previous,
          acceptChanges,
          now,
          pending: await readJson(join(dataDir, config.id, "changelog.json")),
          // Описания переходят из search.json на диске (ADR-0046); нет файла — набор новый.
          previousSearch: await readJson(
            join(dataDir, config.id, "search.json"),
          ),
        });
        reports.push(report);
        // Набор со «СТОП» свои файлы не перезаписывает.
        const written = await writeSetData(dataDir, report);
        if (written === undefined) failed++;
        summaries.push(
          setSummary(config, report, entry, written !== undefined),
        );
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        const result =
          written === undefined
            ? "файлы не записаны"
            : `записано в ${relative(root, join(dataDir, config.id)).replaceAll("\\", "/")}/: ${written
                .map((path) => basename(path))
                .join(", ")}`;
        console.log(
          `${formatBuildReport(report)}\n  ${result} · ${seconds} с\n`,
        );
      } catch (e) {
        failed++;
        errors.push({ id: config.id, message: (e as Error).message });
        console.error(`${config.id}: ошибка — ${(e as Error).message}\n`);
      }
    }
    const sum = (value: (r: SetBuildReport) => number) =>
      reports.reduce((n, r) => n + value(r), 0);
    console.log(
      `Итого: ${sum((r) => r.normalize.total)} иконок · в наборах ${sum((r) => r.icons.length)} · скрытых ${sum((r) => r.changelog.state.icons.size - r.icons.length)} · алиасов ${sum((r) => r.changelog.state.aliases.size)} · остановлено наборов: ${failed}`,
    );
    if (reports.length > 0) {
      console.log(`\nМетаданные и лицензии:\n${formatMetadataTable(reports)}`);
    }
    const galleryDir = join(reportsDir, "data");
    await rm(galleryDir, { recursive: true, force: true });
    await mkdir(galleryDir, { recursive: true });
    let files = 0;
    for (const file of renderBuildGallery(reports)) {
      await writeFile(join(galleryDir, file.name), file.html, "utf8");
      files++;
    }
    await writeFile(
      join(galleryDir, SUMMARY_FILE),
      summaryText({ base: base.label, sets: summaries, errors }),
      "utf8",
    );
    console.log(
      `Галерея (файлов: ${files}): ${join(galleryDir, "index.html")}`,
    );
    console.log(`Контроль качества: ${join(galleryDir, "qc.html")}`);
    console.log(`Метаданные и лицензии: ${join(galleryDir, "metadata.html")}`);
    console.log(`Журнал изменений: ${join(galleryDir, "changelog.html")}`);
    console.log(
      `Сводка для робота обновления: ${join(galleryDir, SUMMARY_FILE)}`,
    );
    process.exit(failed > 0 ? 1 : 0);
  } else if (command === "pr") {
    const [id, ...rest] = args;
    if (!id || rest.length > 0) usageError("Нужно указать один набор.");
    const [config] = pick([id]);
    if (!config) usageError(`Набор «${id}» не найден.`);
    const summaryPath = join(reportsDir, "data", SUMMARY_FILE);
    const text = await readFile(summaryPath, "utf8").catch(() => {
      throw new Error(`нет сводки ${summaryPath} — запустите pnpm data ${id}`);
    });
    const summary = buildSummarySchema.parse(JSON.parse(text));
    const error = summary.errors.find((e) => e.id === id);
    if (error) throw new Error(`${id} не собрался: ${error.message}`);
    const set = summary.sets.find((s) => s.id === id);
    if (!set) {
      throw new Error(`в сводке нет набора ${id} — запустите pnpm data ${id}`);
    }
    const lock = await readLock(lockPath);
    if (JSON.stringify(lock[id]) !== JSON.stringify(set.entry)) {
      throw new Error(
        `сводка собрана не для той версии ${id}, что в sources.lock.json, — запустите pnpm data ${id}`,
      );
    }
    // Версия до обновления — запись в sources.lock.json в main (ADR-0018).
    const base = await baseRevision(root);
    const mainLock = await gitShow(base.commit, "sources.lock.json", root);
    const before =
      mainLock === undefined
        ? undefined
        : lockFileSchema.parse(JSON.parse(mainLock))[id];
    // Имена выпусков git-источника на тегах; сеть недоступна — версии останутся хэшами.
    let tags: Map<string, string> | undefined;
    if (config.source.type === "git" && config.source.latest === "tag") {
      try {
        tags = releaseTagsByCommit(await remoteTags(config.source.repo));
      } catch (e) {
        console.warn(
          `${id}: теги не прочитаны, версии будут хэшами — ${(e as Error).message}`,
        );
      }
    }
    const pr = prText({
      config,
      summary: set,
      before,
      tags,
      links,
      autoMerge: !flags.includes("--no-auto-merge"),
    });
    const outDir = join(root, ".cache", "update", id);
    await mkdir(outDir, { recursive: true });
    const { body, ...meta } = pr;
    await writeFile(
      join(outDir, "pr.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(outDir, "body.md"), body, "utf8");
    console.log(`${id}: ${pr.verdict} — ${pr.title}`);
    for (const reason of pr.reasons) console.log(`  ${reason}`);
    console.log(`Описание PR: ${join(outDir, "body.md")}`);
  } else if (command === "enrich") {
    const dryRun = flags.includes("--dry-run");
    const picked = pick(args);
    // Ключ — только из окружения (pnpm enrich подхватывает .env); в вывод он не попадает.
    const key = process.env.ANTHROPIC_API_KEY;
    if (!dryRun && !key) {
      throw new Error(
        "нет ключа ANTHROPIC_API_KEY: впишите его в .env (имена ключей — в .env.example) или запустите с --dry-run",
      );
    }
    // SDK загружается только здесь: остальным командам он не нужен.
    const client =
      key && !dryRun
        ? (await import("./enrich/client.js")).anthropicBatchClient(key)
        : undefined;
    const reports = await enrichSets(picked, dataDir, {
      ...(client ? { client } : {}),
      stateDir: join(root, ".cache", "enrich"),
      ...(limit === undefined ? {} : { limit }),
      maxCost,
      dryRun,
      wait: !flags.includes("--no-wait"),
      log: (line) => console.log(line),
    });
    console.log("");
    for (const r of reports) console.log(`${formatEnrichReport(r)}\n`);
    console.log(formatEnrichTable(reports));
    const catalog = await countBases(configs, dataDir);
    console.log(
      `В каталоге описания есть у ${catalog.enriched} из ${catalog.bases} базовых иконок.`,
    );
    const reportDir = join(reportsDir, "enrich");
    await mkdir(reportDir, { recursive: true });
    const htmlPath = join(reportDir, "index.html");
    await writeFile(htmlPath, renderEnrichPage(reports, catalog), "utf8");
    console.log(`Отчёт: ${htmlPath}`);
    process.exit(reports.some((r) => r.stop.length > 0) ? 1 : 0);
  } else if (command === "embed") {
    const dryRun = flags.includes("--dry-run");
    const picked = pick(args);
    // Ключ — только из окружения (pnpm embed подхватывает .env); в вывод он не попадает.
    const key = process.env.POLZA_API_KEY;
    if (!dryRun && !key) {
      throw new Error(
        "нет ключа POLZA_API_KEY: впишите его в .env (имена ключей — в .env.example) или запустите с --dry-run",
      );
    }
    const client =
      key && !dryRun ? polzaEmbeddingClient({ apiKey: key }) : undefined;
    const report = await embedSets(picked, dataDir, {
      ...(client ? { client } : {}),
      storeDir: embeddingsDir,
      models,
      maxRub,
      dryRun,
      log: (line) => console.log(line),
    });
    console.log(`\n${formatEmbedReport(report)}`);
    // Готовность — по всему каталогу и всем моделям, а не только по выбранным.
    const { texts } = await loadTexts(configs, dataDir);
    const status = await embedStatus(texts, embeddingsDir, MODELS);
    console.log(
      `\nВекторов по текущему тексту / базовых иконок с описаниями:\n${formatEmbedTable(status)}`,
    );
    // Папка общая с pnpm nearest, поэтому не удаляется.
    const reportDir = join(reportsDir, "embed");
    await mkdir(reportDir, { recursive: true });
    const htmlPath = join(reportDir, "index.html");
    await writeFile(htmlPath, renderEmbedPage(report, status), "utf8");
    console.log(`Отчёт: ${htmlPath}`);
    process.exit(hasStop(report) ? 1 : 0);
  } else if (command === "nearest") {
    const key = process.env.POLZA_API_KEY;
    if (!key) {
      throw new Error(
        "нет ключа POLZA_API_KEY: впишите его в .env (имена ключей — в .env.example)",
      );
    }
    const queries = args.length > 0 ? args : NEAREST_PAIRS.flat();
    // Запросы печатаются, чтобы было видно, что кириллица дошла целой.
    console.log(`Запросы: ${queries.map((q) => `«${q}»`).join(", ")}`);
    const report = await nearestQueries(configs, dataDir, {
      client: polzaEmbeddingClient({ apiKey: key }),
      storeDir: embeddingsDir,
      queries,
      models,
      log: (line) => console.log(line),
    });
    console.log(`\n${formatNearest(report)}`);
    const reportDir = join(reportsDir, "embed");
    await mkdir(reportDir, { recursive: true });
    const htmlPath = join(reportDir, "nearest.html");
    await writeFile(htmlPath, renderNearestPage(report), "utf8");
    console.log(`\nСтраница: ${htmlPath}`);
    process.exit(nearestStop(report) ? 1 : 0);
  } else if (command === "judge") {
    if (args.length > 0) usageError("pnpm judge принимает только флаги.");
    const dryRun = flags.includes("--dry-run");
    // Ключ — только из окружения (pnpm judge подхватывает .env); в вывод он не попадает.
    const key = process.env.POLZA_API_KEY;
    if (!dryRun && !key) {
      throw new Error(
        "нет ключа POLZA_API_KEY: впишите его в .env (имена ключей — в .env.example) или запустите с --dry-run",
      );
    }
    const report = await judgeEval(configs, dataDir, {
      ...(key && !dryRun ? { client: polzaChatClient({ apiKey: key }) } : {}),
      ...(key ? { embedClient: polzaEmbeddingClient({ apiKey: key }) } : {}),
      queriesPath,
      judgmentsPath,
      overridesPath,
      storeDir: embeddingsDir,
      queryDir,
      ...(limit === undefined ? {} : { limit }),
      maxRub: judgeMaxRub,
      dryRun,
      log: (line) => console.log(line),
    });
    console.log(`\n${formatJudgeReport(report)}`);
    const reportDir = join(reportsDir, "eval");
    await mkdir(reportDir, { recursive: true });
    const htmlPath = join(reportDir, "judge.html");
    await writeFile(
      htmlPath,
      renderJudgePage(report, await readOverrides(overridesPath)),
      "utf8",
    );
    console.log(`Страница: ${htmlPath}`);
    process.exit(judgeStop(report) ? 1 : 0);
  } else if (command === "eval") {
    if (args.length > 0) usageError("pnpm eval принимает только флаги.");
    // Ключ нужен только для векторов новых запросов: с полным кэшем замер идёт без сети.
    const key = process.env.POLZA_API_KEY;
    const report = await evaluate(configs, dataDir, {
      queriesPath,
      judgmentsPath,
      overridesPath,
      storeDir: embeddingsDir,
      queryDir,
      ...(key ? { embedClient: polzaEmbeddingClient({ apiKey: key }) } : {}),
      models,
      log: (line) => console.log(line),
    });
    console.log(`\n${formatEvalReport(report)}`);
    const reportDir = join(reportsDir, "eval");
    await mkdir(reportDir, { recursive: true });
    const htmlPath = join(reportDir, "index.html");
    await writeFile(htmlPath, renderEvalPage(report), "utf8");
    if (!evalStop(report)) {
      const json = canonicalJson(baselineJson(report));
      await writeFile(join(reportDir, "eval.json"), json, "utf8");
      if (flags.includes("--baseline")) {
        await writeFile(join(evalDir, "baseline.json"), json, "utf8");
        console.log(`Итог для фазы 2: ${join(evalDir, "baseline.json")}`);
      }
    }
    console.log(`Отчёт: ${htmlPath}`);
    process.exit(evalStop(report) ? 1 : 0);
  } else if (command === "search-page") {
    if (args.length > 0) usageError("pnpm search-page принимает только флаги.");
    const key = process.env.POLZA_API_KEY;
    const { catalog, errors } = await loadCatalog(configs, dataDir);
    for (const e of errors) console.warn(`${e.id}: не прочитан — ${e.message}`);
    const text = buildTextIndex(catalog.docs.map((d) => d.words));
    const loaded: ModelVectors[] = [];
    for (const model of models) {
      console.log(`${model.key}: загружаю векторы…`);
      const settings = MODEL_SEARCH[model.key];
      const mv = await loadModelVectors(
        catalog,
        model,
        embeddingsDir,
        settings ? [settings.length] : [],
      );
      for (const note of mv.notes) console.log(`  ${note}`);
      loaded.push(mv);
    }
    await startSearchServer({
      port,
      catalog,
      text,
      models: loaded,
      settings: MODEL_SEARCH,
      ...(key ? { client: polzaEmbeddingClient({ apiKey: key }) } : {}),
      queryDir,
      reportsDir,
    });
    console.log(
      `Страница поиска: http://127.0.0.1:${port}/ — карточек ${catalog.docs.length}. Остановить — Ctrl+C.`,
    );
    if (!key) {
      console.log(
        "Нет POLZA_API_KEY: векторы новых запросов не считаются — только текстовая часть и кэш.",
      );
    }
  } else if (command === "cdn") {
    const [sub, ...rest] = args;
    const dryRun = flags.includes("--dry-run");
    if (
      (sub !== "build" &&
        sub !== "upload" &&
        sub !== "verify" &&
        sub !== "check") ||
      rest.length > 0 ||
      (sub !== "upload" && dryRun)
    ) {
      usageError(
        "pnpm cdn: нужна подкоманда build, upload [--dry-run], verify или check без имён наборов — манифест описывает все наборы сразу.",
      );
    }
    if (sub === "check") {
      // Живые адреса обоих хостов (ADR-0023, ADR-0025): ни сборки, ни ключей не нужно. По очереди:
      // с медленного соединения важны строки о ходе проверки.
      const reports: CheckReport[] = [];
      for (const target of CDN_HOSTS) {
        console.log(`Проверяю раздачу https://${target.host}/…`);
        const report = await checkCdn({
          target,
          log: (line) => console.log(`  ${line}`),
        });
        console.log("");
        console.log(formatCheckTable(report));
        for (const line of formatCheckSummary(report)) console.log(line);
        console.log("");
        reports.push(report);
      }
      const cross = compareHostManifests(reports);
      for (const line of formatCheckTotal(reports, cross)) console.log(line);
      // Edge API работает поверх тех же файлов (ADR-0024): его ответы сверяются со статикой версии
      // из манифеста R2, уже прочитанного выше.
      console.log(`\nПроверяю edge API https://${API_HOST}/…`);
      const manifest = reports.find(
        (r) => r.provider === "cloudflare",
      )?.manifest;
      const api = await checkApi({
        ...(manifest === undefined ? {} : { manifest }),
        log: (line) => console.log(`  ${line}`),
      });
      printApiCheck(api);
      process.exit(
        reports.some(checkFailed) || cross.length > 0 || apiCheckFailed(api)
          ? 1
          : 0,
      );
    }
    // Выгрузка и сверка начинаются со сборки: dist-cdn/ всегда от текущего data/ (без изменений — секунды).
    const report = await buildCdn(configs, {
      dataDir,
      outDir: distCdnDir,
      log: (line) => console.log(line),
    });
    console.log("");
    for (const r of report.sets) console.log(`${formatCdnReport(r)}\n`);
    console.log(formatCdnTable(report.sets));
    for (const line of formatCdnSummary(report)) console.log(line);
    const reportDir = join(reportsDir, "cdn");
    await mkdir(reportDir, { recursive: true });
    const htmlPath = join(reportDir, "index.html");
    await writeFile(htmlPath, renderCdnPage(report), "utf8");
    console.log(`Отчёт: ${htmlPath}`);
    if (sub === "build") process.exit(cdnStop(report) ? 1 : 0);
    const verify = sub === "verify";
    if (cdnStop(report)) {
      console.error(
        `Сборка остановлена — ${verify ? "сверка" : "выгрузка"} не начиналась.`,
      );
      process.exit(1);
    }
    // Ключи обоих хостов — до первого запроса: списки хранилищ без них не отдаются.
    const env = (name: string) => process.env[name] ?? "";
    const missing = [
      ...Object.values(R2_ENV),
      ...Object.values(BUNNY_ENV),
    ].filter((name) => env(name) === "");
    if (missing.length > 0) {
      console.error(
        `Нет ключей: ${missing.join(", ")}. Локально впишите их в .env (имена — в .env.example), в CI это секреты GitHub Actions. Без ключей не прочитать списки хранилищ, поэтому --dry-run и verify тоже их требуют.`,
      );
      process.exit(1);
    }
    const clients: Record<CdnProvider, StorageClient> = {
      cloudflare: r2Client({
        accountId: env(R2_ENV.accountId),
        accessKeyId: env(R2_ENV.accessKeyId),
        secretAccessKey: env(R2_ENV.secretAccessKey),
        bucket: R2_BUCKET,
      }),
      bunny: bunnyClient({
        zone: BUNNY_STORAGE_ZONE,
        password: env(BUNNY_ENV.password),
      }),
    };
    const hosts = CDN_HOSTS.map((h) => ({
      host: h.host,
      storage: h.storage,
      client: clients[h.provider],
    }));
    const names = hosts.map((h) => `${h.host} (${h.storage})`).join(", затем ");
    console.log(
      verify
        ? `\nСверка хостов: сравниваю хранилища со сборкой ${OUT_DIR}/, ничего не записываю…`
        : dryRun
          ? `\nТолько показ: сравниваю ${OUT_DIR}/ с хранилищами, ничего не записываю…`
          : `\nВыгружаю ${OUT_DIR}/: файлы версий — на ${names}; манифесты — в конце…`,
    );
    const upload = await uploadCdn({
      outDir: distCdnDir,
      hosts,
      dryRun: dryRun || verify,
      log: (line) => console.log(line),
    });
    console.log("");
    for (const h of upload.hosts) {
      console.log(formatHostTitle(h));
      for (const r of h.sets) console.log(`${formatUploadReport(r)}\n`);
      if (h.sets.length > 0) console.log(formatUploadTable(h.sets));
      console.log("");
    }
    for (const line of formatUploadSummary(upload)) console.log(line);
    if (verify)
      for (const line of formatVerifyVerdict(upload)) console.log(line);
    const pagePath = join(reportDir, verify ? "verify.html" : "upload.html");
    await writeFile(
      pagePath,
      renderUploadPage(upload, verify ? "Сверка хостов" : "Выгрузка"),
      "utf8",
    );
    console.log(`Отчёт: ${pagePath}`);
    process.exit((verify ? verifyFailed(upload) : uploadStop(upload)) ? 1 : 0);
  } else if (command === "packages") {
    const [sub, ...ids] = args;
    const allowNew = flags.includes("--new");
    const force = flags.includes("--force");
    const wait = flags.some(
      (f) => f.startsWith("--wait=") || f.startsWith("--plan="),
    );
    if (
      (sub !== "prepare" && sub !== "verify") ||
      (sub !== "prepare" && (allowNew || force)) ||
      (sub !== "verify" && wait)
    ) {
      usageError(
        "pnpm packages: нужна подкоманда prepare [id…] [--new] [--force] или verify [id…] [--wait=N] [--plan=…].",
      );
    }
    const chosen = pick(ids);
    const registry = registryClient();
    const reportDir = join(reportsDir, "npm");
    await mkdir(reportDir, { recursive: true });
    if (sub === "prepare") {
      console.log(
        `Готовлю пакеты npm в ${NPM_OUT_DIR}/ и сверяюсь с реестром — только чтение, ничего не публикую…`,
      );
      const report = await preparePackages(chosen, {
        dataDir,
        outDir: distNpmDir,
        registry,
        allowNew,
        force,
        keep: configs.map((c) => c.id),
        log: (line) => console.log(line),
      });
      console.log("");
      for (const r of report.packages) {
        console.log(`${formatPrepareReport(r, report.tag)}\n`);
      }
      console.log(formatPrepareTable(report));
      for (const line of formatPrepareSummary(report)) console.log(line);
      const htmlPath = join(reportDir, "index.html");
      await writeFile(htmlPath, renderPreparePage(report), "utf8");
      console.log(`Отчёт: ${htmlPath}`);
      process.exit(prepareStop(report) ? 1 : 0);
    }
    console.log("Проверяю пакеты в реестре npm…");
    const report = await verifyPackages(chosen, {
      dataDir,
      registry,
      expected: planPath === undefined ? undefined : await readPlan(planPath),
      waitMs: waitSeconds * 1000,
      log: (line) => console.log(line),
    });
    console.log("");
    for (const e of report.packages) {
      console.log(`${formatNpmVerifyEntry(e, report.tag)}\n`);
    }
    console.log(formatNpmVerifyTable(report));
    console.log(formatNpmVerdict(report));
    const htmlPath = join(reportDir, "verify.html");
    await writeFile(htmlPath, renderNpmVerifyPage(report), "utf8");
    console.log(`Отчёт: ${htmlPath}`);
    process.exit(npmVerifyFailed(report) ? 1 : 0);
  } else if (command === "api") {
    const [sub, ...rest] = args;
    if (
      (sub !== "build" && sub !== "preview" && sub !== "check") ||
      rest.length > 0 ||
      (sub !== "preview" && flags.some((f) => f.startsWith("--port="))) ||
      (sub !== "check" && expectBuild !== undefined)
    ) {
      usageError(
        "pnpm api: нужна подкоманда build, preview [--port=N] или check [--expect-build=…].",
      );
    }
    if (sub === "build") {
      const report = await buildApi({ root, outDir: distApiDir });
      console.log(
        `Функция edge API: ${API_OUT_DIR}/${WORKER_FILE} — ${formatBytes(report.bytes)}, в gzip ${formatBytes(report.gzipBytes)}; сборка ${report.build}.`,
      );
      console.log(
        report.written.length === 0
          ? "Без изменений: файлы на диске те же."
          : `Записано: ${report.written.join(", ")}.`,
      );
      process.exit(0);
    }
    if (sub === "check") {
      console.log(
        `Проверяю edge API https://${API_HOST}/${expectBuild === undefined ? "" : `, жду сборку ${expectBuild}`}…`,
      );
      const report = await checkApi({
        ...(expectBuild === undefined ? {} : { expectBuild }),
        log: (line) => console.log(`  ${line}`),
      });
      printApiCheck(report);
      process.exit(apiCheckFailed(report) ? 1 : 0);
    }
    // Превью: раздача всегда от текущего data/ (без изменений — секунды), функция — свежая сборка.
    const cdn = await buildCdn(configs, { dataDir, outDir: distCdnDir });
    if (cdnStop(cdn)) {
      console.error(
        "Сборка раздачи остановлена — превью без данных не запустить: pnpm cdn build покажет почему.",
      );
      process.exit(1);
    }
    const preview = await startApiPreview({
      root,
      outDir: distApiDir,
      cdnDir: distCdnDir,
      port,
    });
    console.log(
      `Превью edge API: http://127.0.0.1:${preview.port}/ — сборка ${preview.build}, данные из dist-cdn/. Остановить — Ctrl+C.`,
    );
  } else {
    usageError(
      command ? `Неизвестная команда «${command}».` : "Нужна команда.",
    );
  }
} catch (e) {
  console.error(`Ошибка: ${(e as Error).message}`);
  process.exit(1);
}
