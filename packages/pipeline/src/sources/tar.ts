import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface ExtractOptions {
  /** Папка, куда складываются нужные файлы. */
  dest: string;
  /** Нужен ли файл; путь относительный, без верхней папки архива (`package/`). */
  wanted: (path: string) => boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface Extracted {
  files: { path: string; size: number }[];
  bytes: number;
}

const BLOCK = 512;

/** Читает поток кусками и отдаёт ровно столько байт, сколько просят. */
class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private done = false;
  constructor(private readonly it: AsyncIterator<Buffer>) {}

  private async fill(n: number): Promise<void> {
    while (this.buf.length < n && !this.done) {
      const r = await this.it.next();
      if (r.done) this.done = true;
      else
        this.buf = this.buf.length
          ? Buffer.concat([this.buf, r.value])
          : r.value;
    }
  }

  async take(n: number): Promise<Buffer> {
    await this.fill(n);
    if (this.buf.length < n) throw new Error("архив обрезан");
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (this.buf.length === 0) {
        await this.fill(1);
        if (this.buf.length === 0) throw new Error("архив обрезан");
      }
      const k = Math.min(left, this.buf.length);
      this.buf = this.buf.subarray(k);
      left -= k;
    }
  }

  /** Дочитывает поток до конца: хэш целостности считается по всем байтам. */
  async drain(): Promise<void> {
    this.buf = Buffer.alloc(0);
    while (!this.done) {
      const r = await this.it.next();
      if (r.done) this.done = true;
    }
  }
}

function cstring(b: Buffer, start: number, end: number): string {
  const zero = b.indexOf(0, start);
  return b.toString("utf8", start, zero === -1 || zero > end ? end : zero);
}

function octal(b: Buffer, start: number, end: number): number {
  if (((b[start] ?? 0) & 0x80) !== 0) {
    throw new Error("размеры в формате base-256 не поддерживаются");
  }
  const text = cstring(b, start, end).trim();
  const n = text === "" ? 0 : Number.parseInt(text, 8);
  if (!Number.isFinite(n) || n < 0)
    throw new Error("повреждён заголовок архива");
  return n;
}

function checksumOk(h: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 32 : (h[i] ?? 0);
  }
  return sum === octal(h, 148, 156);
}

function paxPath(data: Buffer): string | undefined {
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space === -1) break;
    const len = Number.parseInt(data.toString("utf8", pos, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = data.toString("utf8", space + 1, pos + len - 1);
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === "path")
      return record.slice(eq + 1);
    pos += len;
  }
  return undefined;
}

/** Проверяет путь из архива и убирает верхнюю папку (`package/`). */
function relativeEntryPath(name: string): string {
  if (
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name) ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`небезопасный путь в архиве: ${JSON.stringify(name)}`);
  }
  // Сегмент «.» ничего не меняет (так упаковано, например, в @phosphor-icons/core), «..» опасен.
  const parts = name.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.some((s) => s === "..")) {
    throw new Error(`небезопасный путь в архиве: ${JSON.stringify(name)}`);
  }
  return parts.slice(1).join("/");
}

/**
 * Распаковывает обычные файлы из потока tar (уже без gzip) и сохраняет только нужные.
 * Любой небезопасный путь, ссылка на нужном месте или превышение лимитов — ошибка.
 */
export async function extractTar(
  source: AsyncIterable<Buffer>,
  options: ExtractOptions,
): Promise<Extracted> {
  const maxFile = options.maxFileBytes ?? 5 * 1024 * 1024;
  const maxTotal = options.maxTotalBytes ?? 500 * 1024 * 1024;
  const dest = resolve(options.dest);
  const reader = new Reader(source[Symbol.asyncIterator]());
  const result: Extracted = { files: [], bytes: 0 };
  let pendingPath: string | undefined;

  for (;;) {
    const header = await reader.take(BLOCK);
    if (header.every((x) => x === 0)) break;
    if (!checksumOk(header)) throw new Error("повреждён заголовок архива");

    const size = octal(header, 124, 136);
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    const type =
      (header[156] ?? 0) === 0 ? "0" : String.fromCharCode(header[156] ?? 0);

    if (type === "x" || type === "L") {
      if (size > 64 * 1024)
        throw new Error("слишком длинный служебный заголовок");
      const data = await reader.take(size);
      await reader.skip(padded - size);
      pendingPath =
        type === "x" ? paxPath(data) : cstring(data, 0, data.length);
      continue;
    }
    if (type === "g") {
      await reader.skip(padded);
      continue;
    }

    const prefix = cstring(header, 345, 500);
    const base = cstring(header, 0, 100);
    const full = pendingPath ?? (prefix ? `${prefix}/${base}` : base);
    pendingPath = undefined;
    const rel = relativeEntryPath(full);

    const isFile = type === "0";
    if (!rel || type === "5" || !options.wanted(rel)) {
      await reader.skip(padded);
      continue;
    }
    if (!isFile)
      throw new Error(`«${rel}» — не обычный файл (ссылки не поддерживаются)`);
    if (size > maxFile)
      throw new Error(`файл «${rel}» больше лимита ${maxFile} байт`);
    if (result.bytes + size > maxTotal)
      throw new Error("распакованные файлы больше общего лимита");

    const target = resolve(join(dest, rel));
    if (!target.startsWith(dest + sep)) {
      throw new Error(`небезопасный путь в архиве: ${JSON.stringify(rel)}`);
    }
    const data = await reader.take(size);
    await reader.skip(padded - size);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    result.files.push({ path: rel, size });
    result.bytes += size;
  }

  await reader.drain();
  return result;
}
