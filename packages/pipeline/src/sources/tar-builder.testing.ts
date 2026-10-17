import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export interface TarEntry {
  name: string;
  data?: string | Buffer;
  /** По умолчанию обычный файл ("0"); "2" — симлинк, "5" — папка. */
  type?: string;
}

function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}

/** Собирает несжатый tar из списка записей. */
export function makeTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    parts.push(header(e.name, data.length, e.type ?? "0"));
    if (data.length > 0) {
      parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function makeTgz(entries: TarEntry[]): Buffer {
  return gzipSync(makeTar(entries));
}

export function integrityOf(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/** Асинхронный итератор кусками — как настоящий поток. */
export async function* chunked(
  buf: Buffer,
  size = 700,
): AsyncGenerator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

/** Подменный fetch: отвечает по адресам из таблицы и считает обращения. */
export function fakeFetch(routes: Record<string, string | Buffer | object>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (Buffer.isBuffer(body)) return new Response(new Uint8Array(body));
    return typeof body === "string" ? new Response(body) : Response.json(body);
  }) as typeof fetch;
  return { fetch: fn, calls };
}
