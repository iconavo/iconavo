// Общее для хранилищ раздачи (ADR-0022, ADR-0025): что выгрузке нужно от хранилища — список, запись
// и чтение объектов, — и правила повторов. Клиенты — R2 (s3.ts) и Bunny (bunny.ts). Временные отказы,
// сбои сети и истёкшее ожидание повторяются с паузой, как у Polza (embed/client.ts); ключ не подошёл —
// «СТОП» всего хоста; другой отказ — «СТОП» набора. Тело ответа читается внутри попытки, так что
// обрыв посреди большого списка тоже повторяется. Ключи из сообщений об ошибках вычищены.

import { retryDelay } from "../embed/client.js";

export interface RemoteObject {
  key: string;
  size: number;
  /** ETag без кавычек, строчными; у обычной загрузки в R2 — MD5 содержимого в hex. */
  etag?: string;
  /** SHA-256 содержимого в hex, строчными: его отдаёт список файлов Bunny. */
  sha256?: string;
}

export interface PutOptions {
  contentType: string;
  cacheControl: string;
  /** MD5 и SHA-256 содержимого в hex: хранилище сверяет полученное с одним из них (R2 — MD5, Bunny — SHA-256). */
  md5: string;
  sha256: string;
}

/** Та часть хранилища, которая нужна выгрузке; в тестах её подменяют (storage.testing.ts). */
export interface StorageClient {
  /** Все объекты, ключи которых начинаются с prefix. */
  list(prefix: string): Promise<RemoteObject[]>;
  put(key: string, body: Uint8Array, options: PutOptions): Promise<void>;
  /** Содержимое объекта; нет объекта — undefined. */
  get(key: string): Promise<Uint8Array | undefined>;
}

/** Что останавливает ошибка: всю работу с хостом (ключи, доступ) или только текущий набор. */
export type StorageStopScope = "run" | "set";

export const storageError = (message: string, scope: StorageStopScope) =>
  Object.assign(new Error(message), { scope });

/** Ошибка без пометки — ошибка набора: остальные наборы продолжают. */
export const storageErrorScope = (e: unknown): StorageStopScope =>
  (e as { scope?: StorageStopScope }).scope === "run" ? "run" : "set";

export interface RetryRules {
  /** Ответы, после которых нет смысла продолжать: код → подсказка. */
  runStops: Readonly<Record<number, string>>;
  /** Временный отказ — повторить. */
  retryable: (status: number) => boolean;
  /** Что нельзя показывать в сообщениях: ключи. */
  secrets: readonly string[];
  sleep: (ms: number) => Promise<void>;
  /** Ожидание одной попытки вместе с чтением тела. */
  timeoutMs: number;
  maxAttempts: number;
  /** Ответ 404 — не ошибка: его получает read. */
  allow404?: boolean;
}

/**
 * Запрос с повторами: send отправляет его заново на каждой попытке (R2 подписывает каждую), read
 * читает ответ внутри той же попытки и под тем же ожиданием.
 */
export async function requestWithRetries<T>(
  label: string,
  send: (signal: AbortSignal) => Promise<Response>,
  read: (res: Response) => Promise<T>,
  rules: RetryRules,
): Promise<T> {
  const secrets = rules.secrets.filter((s) => s !== "");
  // Начало ответа для сообщения об ошибке: в одну строку и без ключей, даже если сервер их повторил.
  const snippet = (text: string) => {
    let out = text;
    for (const secret of secrets) out = out.replaceAll(secret, "…");
    return out.replace(/\s+/g, " ").trim().slice(0, 300);
  };
  let last = "";
  for (let attempt = 1; ; attempt++) {
    let wait: number | undefined;
    try {
      const res = await send(AbortSignal.timeout(rules.timeoutMs));
      if (res.ok || (res.status === 404 && rules.allow404 === true)) {
        return await read(res);
      }
      const text = await res.text();
      const reason = `HTTP ${res.status}${text.trim() === "" ? "" : ` — ${snippet(text)}`}`;
      const fatal = rules.runStops[res.status];
      if (fatal !== undefined) {
        throw storageError(`${label}: ${fatal} (${reason})`, "run");
      }
      if (!rules.retryable(res.status)) {
        throw storageError(`${label}: запрос отклонён (${reason})`, "set");
      }
      last = reason;
      wait = retryDelay(res.headers.get("retry-after"), attempt);
    } catch (e) {
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        last = `нет ответа за ${Math.round(rules.timeoutMs / 1000)} с`;
      } else if (
        e instanceof TypeError &&
        (e.message === "fetch failed" || "cause" in e)
      ) {
        // Так fetch в Node сообщает о сбое соединения, в том числе посреди тела; причина — в cause.
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        last = `сбой сети${cause ? ` (${cause})` : ""}: ${e.message}`;
      } else {
        throw (e as { scope?: StorageStopScope }).scope
          ? e
          : storageError(`${label}: ${snippet((e as Error).message)}`, "set");
      }
    }
    if (attempt >= rules.maxAttempts) {
      throw storageError(
        `${label}: ${last} — не получилось за ${rules.maxAttempts} попыток`,
        "set",
      );
    }
    await rules.sleep(wait ?? retryDelay(null, attempt));
  }
}
