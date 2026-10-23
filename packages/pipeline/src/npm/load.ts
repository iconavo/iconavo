// Чтение набора из data/ для пакета npm (ADR-0026): общие проверки раздачи (loadSetData), плюс
// metadata.json и журнал по схемам, лицензия автора — тот же текст, что в info.json, NOTICE — только
// если он есть в info.json. Файлы данных уходят в пакет побайтно, поэтому в них не должно быть «\r»:
// иначе пакет, собранный на Windows, отличался бы от собранного в CI.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChangelogFile,
  type MetadataFile,
  validate,
} from "@iconavo-ui/schema";
import {
  issuesText,
  loadSetData,
  readSetFile,
  rebuildHint,
  type SetData,
} from "../cdn/load.js";
import type { SourceConfig } from "../sources/config.js";
import type { NpmFile } from "./files.js";

export interface NpmSet extends SetData {
  metadata: MetadataFile;
  /** Версии набора из журнала: текущая первой, затем прошлые (ADR-0018). */
  releases: string[];
  /** Файлы из data/{набор}/, которые идут в пакет как есть: данные, LICENSE и NOTICE. */
  files: NpmFile[];
}

const CR = 0x0d;

async function readOptional(
  dir: string,
  file: string,
  hint: string,
): Promise<Uint8Array | undefined> {
  try {
    return await readFile(join(dir, file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`${file} не читается — ${hint}`);
  }
}

/** Набор для пакета: файлы от одной сборки pnpm data и лицензия автора на месте. */
export async function loadNpmSet(
  config: SourceConfig,
  dataDir: string,
): Promise<NpmSet> {
  const set = await loadSetData(config, dataDir);
  const dir = join(dataDir, config.id);
  const hint = rebuildHint(config.id);

  const metadata = await readSetFile(dir, "metadata.json", hint);
  const metadataIssues = validate("metadata", metadata.data);
  if (metadataIssues.length > 0) {
    throw new Error(issuesText("metadata.json", metadataIssues));
  }

  const changelog = await readSetFile(dir, "changelog.json", hint);
  const changelogIssues = validate("changelog", changelog.data);
  if (changelogIssues.length > 0) {
    throw new Error(issuesText("changelog.json", changelogIssues));
  }
  const journal = changelog.data as ChangelogFile;
  if (journal.prefix !== config.id) {
    throw new Error(
      `changelog.json — от набора «${journal.prefix}», а не «${config.id}»`,
    );
  }
  const releases = journal.releases.map((r) => r.version);
  if (releases[0] !== set.version) {
    throw new Error(
      `последний выпуск в changelog.json (${releases[0]}) не от этого icons.json (${set.version}) — ${hint}`,
    );
  }

  const license = await readOptional(dir, "LICENSE", hint);
  if (license === undefined) {
    throw new Error(`нет файла LICENSE — ${hint}`);
  }
  if (Buffer.from(license).toString("utf8") !== set.info.license.text) {
    throw new Error(
      `LICENSE не совпадает с текстом лицензии в info.json — ${hint}`,
    );
  }
  const notice = await readOptional(dir, "NOTICE", hint);
  const expectedNotice = set.info.license.notice;
  if (expectedNotice === undefined && notice !== undefined) {
    throw new Error(`лишний файл NOTICE: в info.json его нет — ${hint}`);
  }
  if (
    expectedNotice !== undefined &&
    (notice === undefined ||
      Buffer.from(notice).toString("utf8") !== expectedNotice)
  ) {
    throw new Error(
      `NOTICE не совпадает с текстом в info.json или его нет — ${hint}`,
    );
  }

  const files: NpmFile[] = [
    { path: "icons.json", data: set.bytes.icons },
    { path: "info.json", data: set.bytes.info },
    { path: "metadata.json", data: metadata.bytes },
    { path: "LICENSE", data: license },
  ];
  if (notice !== undefined) files.push({ path: "NOTICE", data: notice });
  for (const f of files) {
    if (f.data.includes(CR)) {
      throw new Error(
        `в ${f.path} есть перевод строки Windows (\\r): пакет должен быть одинаковым на любой системе — ${hint}`,
      );
    }
  }
  return {
    ...set,
    metadata: metadata.data as MetadataFile,
    releases,
    files,
  };
}

/** Имена набора: иконки и алиасы — то, что не пропадает никогда (ADR-0005). */
export function namesOf(file: {
  icons: Record<string, unknown>;
  aliases?: Record<string, unknown>;
}): Set<string> {
  return new Set([
    ...Object.keys(file.icons),
    ...Object.keys(file.aliases ?? {}),
  ]);
}
