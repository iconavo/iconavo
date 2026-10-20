// Лицензия набора (ADR-0017): текст LICENSE и NOTICE из источника, отпечаток для подтверждения
// человеком и сверка SPDX с package.json пакета npm.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LICENSE_TITLES,
  NOTICE_FILES,
  type SourceConfig,
} from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";

/** Текст как у автора, но без BOM и с переводами строк LF: одинаково на Windows и Linux. */
export const normalizeText = (raw: string) =>
  raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

/** Отпечаток лицензии для подтверждения: SHA-256 от SPDX, текста LICENSE и NOTICE (64 символа). */
export const licenseHash = (spdx: string, text: string, notice?: string) =>
  createHash("sha256")
    .update(JSON.stringify([spdx, text, notice ?? null]))
    .digest("hex");

/** confirmed — человек подтвердил этот текст; unconfirmed — ещё не подтверждал; changed — текст другой. */
export type LicenseStatus = "confirmed" | "unconfirmed" | "changed";

export interface SetLicense {
  spdx: string;
  /** Название для людей, как у Iconify: MIT, ISC, Apache 2.0. */
  title: string;
  /** Описание лицензии на spdx.org. */
  url: string;
  text: string;
  notice?: string;
  /** Файл NOTICE в источнике, если он есть. */
  noticeFile?: string;
  /** Ссылка на источник: репозиторий или страница пакета npm. */
  source: string;
  /** Версия пакета npm или полный хэш коммита. */
  revision: string;
  hash: string;
  status: LicenseStatus;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return normalizeText(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** Поле license из package.json: строка SPDX (старый формат — объект с полем type). */
function packageLicense(text: string): string | undefined {
  const pkg = JSON.parse(text) as { license?: unknown };
  const value = pkg.license;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "type" in value) {
    const type = (value as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return undefined;
}

/** Совпадает ли лицензия в package.json пакета с конфигом; нет — причина «СТОП». */
async function checkPackageLicense(
  dir: string,
  spdx: string,
): Promise<string | undefined> {
  const pkg = await readText(join(dir, "package.json"));
  if (pkg === undefined) {
    return "в источнике нет package.json — лицензию не сверить";
  }
  let declared: string | undefined;
  try {
    declared = packageLicense(pkg);
  } catch {
    return "package.json не читается как JSON — лицензию не сверить";
  }
  if (declared === spdx) return undefined;
  return `в package.json автора лицензия «${declared ?? "не указана"}», а в конфиге «${spdx}» — проверьте, не сменил ли автор лицензию`;
}

/**
 * Читает лицензию набора из скачанного источника. Лицензия возвращается и у остановленного набора,
 * если текст удалось прочитать: отчёт показывает его человеку для подтверждения.
 */
export async function readLicense(
  config: SourceConfig,
  dir: string,
  entry: LockEntry,
): Promise<{ license?: SetLicense; stop: string[] }> {
  const stop: string[] = [];
  const { spdx, file, confirmed } = config.license;
  const text = await readText(join(dir, file));
  if (text === undefined) {
    return { stop: [`файл лицензии ${file} не найден в источнике`] };
  }
  if (text.trim() === "") {
    return { stop: [`файл лицензии ${file} пустой`] };
  }

  let notice: string | undefined;
  let noticeFile: string | undefined;
  for (const candidate of NOTICE_FILES) {
    const found = await readText(join(dir, candidate));
    if (found !== undefined && found.trim() !== "") {
      notice = found;
      noticeFile = candidate;
      break;
    }
  }

  // У пакета npm SPDX берётся из package.json автора (ADR-0017): расхождение с конфигом — повод
  // проверить, не сменил ли автор лицензию.
  if (config.source.type === "npm") {
    const problem = await checkPackageLicense(dir, spdx);
    if (problem) stop.push(problem);
  }

  const hash = licenseHash(spdx, text, notice);
  const status: LicenseStatus =
    confirmed === undefined
      ? "unconfirmed"
      : confirmed === hash
        ? "confirmed"
        : "changed";
  if (status === "unconfirmed") {
    stop.push(
      `лицензия не подтверждена (ADR-0017): прочитайте текст в metadata.html; после подтверждения в sources/${config.id}.ts вписывается license.confirmed: "${hash}"`,
    );
  } else if (status === "changed") {
    stop.push(
      `лицензия изменилась у автора: подтверждён текст ${confirmed?.slice(0, 12)}…, сейчас ${hash.slice(0, 12)}… — прочитайте новый текст в metadata.html и подтвердите заново`,
    );
  }

  const license: SetLicense = {
    spdx,
    title: LICENSE_TITLES[spdx],
    url: `https://spdx.org/licenses/${spdx}.html`,
    text,
    notice,
    noticeFile,
    source:
      config.source.type === "git"
        ? config.source.repo
        : `https://www.npmjs.com/package/${config.source.package}`,
    revision: entry.type === "npm" ? entry.version : entry.commit,
    hash,
    status,
  };
  return { license, stop };
}
