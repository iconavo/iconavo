// Команды конвейера: pnpm sources fetch [id…] | pnpm sources pin <id> [версия|коммит] | pnpm sanitize [id…]
// | pnpm normalize [id…] | pnpm data [id…] [--accept-changes] | pnpm pr <id> [--run-url=… …] [--no-auto-merge]
// | pnpm enrich [id…] [--limit=N] [--max-cost=USD] [--dry-run] [--no-wait]
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBuildReport, renderBuildGallery } from "./build/report.js";
import { buildSet, type SetBuildReport, writeSetData } from "./build/run.js";
import { DEFAULT_MAX_COST } from "./enrich/config.js";
import {
  formatEnrichReport,
  formatEnrichTable,
  renderEnrichPage,
} from "./enrich/report.js";
import { countBases, enrichSets } from "./enrich/run.js";
import { formatMetadataTable } from "./metadata/report.js";
import { formatNormalizeReport, renderGallery } from "./normalize/gallery.js";
import { normalizeSet, type SetNormalizeReport } from "./normalize/run.js";
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
import { fetchStop, formatReport } from "./sources/report.js";
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
      --no-wait                       отправить пакет и выйти; результаты заберёт следующий запуск`;

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
const fixturesDir = join(
  root,
  "packages",
  "pipeline",
  "fixtures",
  "harmful-svg",
);

const [command, ...params] = process.argv.slice(2);
// Флаги отдельно от имён наборов, иначе «--accept-changes» искали бы как набор.
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

// У каждой команды свои флаги; ссылки pnpm pr — в виде --флаг=https://…
const links: PrLinks = {};
let limit: number | undefined;
let maxCost = DEFAULT_MAX_COST;
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
  usageError(`Неизвестный флаг «${flag}».`);
}
const acceptChanges = flags.includes("--accept-changes");

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
  } else {
    usageError(
      command ? `Неизвестная команда «${command}».` : "Нужна команда.",
    );
  }
} catch (e) {
  console.error(`Ошибка: ${(e as Error).message}`);
  process.exit(1);
}
