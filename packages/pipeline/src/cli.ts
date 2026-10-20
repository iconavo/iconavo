// Команды конвейера: pnpm sources fetch [id…] | pnpm sources pin <id> [версия|коммит] | pnpm sanitize [id…]
// | pnpm normalize [id…] | pnpm data [id…] [--accept-changes]
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBuildReport, renderBuildGallery } from "./build/report.js";
import { buildSet, type SetBuildReport, writeSetData } from "./build/run.js";
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
import { baseRevision } from "./sources/git.js";
import { readLock, writeLock } from "./sources/lock.js";
import { loadRegistry } from "./sources/registry.js";
import { formatReport } from "./sources/report.js";

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
                                      с версией в main: на ветке флаг нужен до слияния`;

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

for (const flag of flags) {
  if (command !== "data" || flag !== "--accept-changes") {
    usageError(`Неизвестный флаг «${flag}».`);
  }
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
        });
        reports.push(report);
        // Набор со «СТОП» свои файлы не перезаписывает.
        const written = await writeSetData(dataDir, report);
        if (written === undefined) failed++;
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
    console.log(
      `Галерея (файлов: ${files}): ${join(galleryDir, "index.html")}`,
    );
    console.log(`Контроль качества: ${join(galleryDir, "qc.html")}`);
    console.log(`Метаданные и лицензии: ${join(galleryDir, "metadata.html")}`);
    console.log(`Журнал изменений: ${join(galleryDir, "changelog.html")}`);
    process.exit(failed > 0 ? 1 : 0);
  } else {
    usageError(
      command ? `Неизвестная команда «${command}».` : "Нужна команда.",
    );
  }
} catch (e) {
  console.error(`Ошибка: ${(e as Error).message}`);
  process.exit(1);
}
