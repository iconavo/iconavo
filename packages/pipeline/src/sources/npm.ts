import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import { type Extracted, type ExtractOptions, extractTar } from "./tar.js";

export type FetchFn = typeof fetch;

const REGISTRY = "https://registry.npmjs.org";

const metadataSchema = z.object({
  version: z.string().min(1),
  dist: z.object({
    tarball: z.url(),
    integrity: z
      .string()
      .regex(/^sha512-[A-Za-z0-9+/]+=*$/, "у пакета нет integrity sha512")
      .optional(),
  }),
});

export interface NpmVersion {
  version: string;
  integrity: string;
  tarball: string;
}

/** Метаданные версии пакета (`latest` или точная версия) из реестра npm. */
export async function resolveNpm(
  pkg: string,
  version: string,
  fetchFn: FetchFn = fetch,
): Promise<NpmVersion> {
  const url = `${REGISTRY}/${pkg.replace("/", "%2F")}/${encodeURIComponent(version)}`;
  const res = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`npm: ${pkg}@${version} не найден (HTTP ${res.status})`);
  }
  const meta = metadataSchema.parse(await res.json());
  if (!meta.dist.integrity) {
    throw new Error(
      `npm: у ${pkg}@${meta.version} нет integrity sha512, закрепить нельзя`,
    );
  }
  if (!meta.dist.tarball.startsWith("https://")) {
    throw new Error("npm: адрес архива должен быть https");
  }
  return {
    version: meta.version,
    integrity: meta.dist.integrity,
    tarball: meta.dist.tarball,
  };
}

/**
 * Скачивает архив пакета, считает sha512 «на лету» и сверяет с ожидаемым значением.
 * При несовпадении бросает ошибку; вызывающий код должен удалить уже записанные файлы.
 */
export async function downloadAndExtract(
  tarball: string,
  expectedIntegrity: string,
  options: ExtractOptions,
  fetchFn: FetchFn = fetch,
): Promise<Extracted> {
  const res = await fetchFn(tarball);
  if (!res.ok || !res.body) {
    throw new Error(`npm: не удалось скачать архив (HTTP ${res.status})`);
  }
  const hash = createHash("sha512");
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const gunzip = createGunzip();
  const failed = pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    tap,
    gunzip,
  );
  failed.catch(() => {}); // ошибка придёт через gunzip при чтении ниже

  let extracted: Extracted;
  try {
    extracted = await extractTar(gunzip as AsyncIterable<Buffer>, options);
    await failed;
  } catch (e) {
    gunzip.destroy();
    throw e;
  }
  const actual = `sha512-${hash.digest("base64")}`;
  if (actual !== expectedIntegrity) {
    throw new Error(
      `npm: целостность не совпала (ожидалось ${expectedIntegrity.slice(0, 20)}…, получено ${actual.slice(0, 20)}…)`,
    );
  }
  return extracted;
}
