// Клиент хранилища Bunny (шаг 4 фазы 2, ADR-0025) поверх встроенного fetch: родной HTTP-интерфейс —
// список папки, запись и чтение файла. Не S3: S3-интерфейс Bunny на 22 октября 2026 — предварительная
// версия, включается только при создании хранилища, не хранит Cache-Control и не обещает ETag = MD5.
// У родного интерфейса ключ — пароль хранилища в заголовке AccessKey (подписи нет); при записи сервер
// сверяет SHA-256 из заголовка Checksum и отвергает несовпавший файл; список папки отдаёт SHA-256
// каждого файла (поле Checksum есть в ответах, хотя в официальной схеме его нет) — выгрузка сверяет
// его с файлом сумм версии. Cache-Control у файлов Bunny не хранит: его, CORS и защиту ставят правила
// зоны CDN (ADR-0025). Повторы и остановки — storage.ts; 400 у Bunny тоже временный: так хранилище
// отвечает на превышение лимитов одновременных запросов.

import { z } from "zod";
import { retryable } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";
import {
  BUNNY_LIST_TIMEOUT_MS,
  BUNNY_STORAGE_ENDPOINT,
  UPLOAD_MAX_ATTEMPTS,
  UPLOAD_TIMEOUT_MS,
} from "./config.js";
import {
  type RemoteObject,
  requestWithRetries,
  type StorageClient,
} from "./storage.js";

/** Ответы, после которых нет смысла продолжать ни один набор. */
export const BUNNY_RUN_STOPS: Record<number, string> = {
  401: "пароль хранилища Bunny не подошёл — проверьте BUNNY_STORAGE_PASSWORD (Storage → FTP & API Access → Password); так же Bunny отвечает на адрес не того региона и чужое имя хранилища — BUNNY_STORAGE_ENDPOINT и BUNNY_STORAGE_ZONE в config.ts",
  403: "у пароля хранилища Bunny нет доступа — нужен Password, а не Read-only password",
};

/** Временные отказы Bunny: как у всех, плюс 400 — так хранилище отвечает на превышение лимитов. */
export const bunnyRetryable = (status: number) =>
  status === 400 || retryable(status);

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Строка списка папки: лишние поля Bunny не мешают. */
const listSchema = z.array(
  z.object({
    ObjectName: z.string().min(1),
    Length: z.number().int().nonnegative(),
    IsDirectory: z.boolean(),
    Checksum: z.string().nullish(),
  }),
);

/**
 * Разбор списка папки dir (с «/» на конце или пустой — корень): файлы с ключами от корня хранилища и
 * вложенные папки. Checksum берётся, только если это SHA-256 в hex; иначе сверять нечем.
 */
export function parseBunnyList(
  json: unknown,
  dir: string,
): { files: RemoteObject[]; dirs: string[] } {
  const parsed = listSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`ответ на список папки «${dir}» — не список файлов Bunny`);
  }
  const files: RemoteObject[] = [];
  const dirs: string[] = [];
  for (const o of parsed.data) {
    if (o.ObjectName.includes("/")) {
      throw new Error(`в списке папки «${dir}» имя с «/»: ${o.ObjectName}`);
    }
    const key = `${dir}${o.ObjectName}`;
    const checksum = o.Checksum ?? "";
    if (o.IsDirectory) {
      dirs.push(`${key}/`);
    } else if (/^[0-9a-fA-F]{64}$/.test(checksum)) {
      files.push({ key, size: o.Length, sha256: checksum.toLowerCase() });
    } else {
      files.push({ key, size: o.Length });
    }
  }
  return { files, dirs };
}

export interface BunnyOptions {
  /** Имя хранилища (Storage Zone). */
  zone: string;
  /** Пароль хранилища (FTP & API Access → Password). */
  password: string;
  /** Адрес HTTP-интерфейса по основному региону хранилища. */
  endpoint?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  /** Ожидание записи и чтения файла; у списка папки — своё, listTimeoutMs. */
  timeoutMs?: number;
  listTimeoutMs?: number;
  maxAttempts?: number;
}

export function bunnyClient(options: BunnyOptions): StorageClient {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const endpoint = (options.endpoint ?? BUNNY_STORAGE_ENDPOINT).replace(
    /\/+$/,
    "",
  );
  const timeoutMs = options.timeoutMs ?? UPLOAD_TIMEOUT_MS;
  const rules = {
    runStops: BUNNY_RUN_STOPS,
    retryable: bunnyRetryable,
    secrets: [options.password],
    sleep,
    maxAttempts: options.maxAttempts ?? UPLOAD_MAX_ATTEMPTS,
  };
  const url = (path: string) =>
    `${endpoint}/${[options.zone, ...path.split("/")].map(encodeURIComponent).join("/")}`;
  const auth = { AccessKey: options.password };

  /** Файлы и папки одной папки; нет папки — пусто. */
  async function listDir(dir: string) {
    return requestWithRetries(
      `GET ${options.zone}/${dir}`,
      (signal) => fetchFn(url(dir), { headers: auth, signal }),
      async (res) => {
        const text = await res.text();
        if (res.status === 404) return { files: [], dirs: [] };
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`ответ на список папки «${dir}» — не JSON`);
        }
        return parseBunnyList(json, dir);
      },
      {
        ...rules,
        timeoutMs: options.listTimeoutMs ?? BUNNY_LIST_TIMEOUT_MS,
        allow404: true,
      },
    );
  }

  return {
    async list(prefix) {
      // Bunny отдаёт одну папку без вложенных: читается папка префикса, а совпавшие папки — целиком.
      const cut = prefix.lastIndexOf("/") + 1;
      const start = prefix.slice(cut);
      const out: RemoteObject[] = [];
      const walk = async (dir: string, all: boolean) => {
        const { files, dirs } = await listDir(dir);
        const matches = (key: string) =>
          all || key.slice(dir.length).startsWith(start);
        out.push(...files.filter((f) => matches(f.key)));
        // По одной: одновременно Bunny отдаёт не больше пяти списков.
        for (const sub of dirs.filter(matches)) await walk(sub, true);
      };
      await walk(prefix.slice(0, cut), false);
      return out.sort((a, b) => order(a.key, b.key));
    },
    async put(key, body, o) {
      await requestWithRetries(
        `PUT ${key}`,
        (signal) =>
          fetchFn(url(key), {
            method: "PUT",
            headers: {
              ...auth,
              Checksum: o.sha256.toUpperCase(),
              "Content-Type": o.contentType,
            },
            body: body as BodyInit,
            signal,
          }),
        async (res) => {
          await res.arrayBuffer();
        },
        { ...rules, timeoutMs },
      );
    },
    async get(key) {
      return requestWithRetries(
        `GET ${key}`,
        (signal) => fetchFn(url(key), { headers: auth, signal }),
        async (res) => {
          const body = new Uint8Array(await res.arrayBuffer());
          return res.status === 404 ? undefined : body;
        },
        { ...rules, timeoutMs, allow404: true },
      );
    },
  };
}
