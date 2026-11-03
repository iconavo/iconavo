// ZIP сумки (шаг 5 фазы 4, ADR-0042): свой модуль без зависимостей — файлы без сжатия (метод store),
// контрольная сумма CRC-32, имена в UTF-8 (бит 11). Иконки весят килобайты, сжатие не нужно; архив
// открывают проводник Windows, Finder и unzip.

export interface ZipFile {
  path: string;
  data: Uint8Array | string;
}

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE), как у ZIP и PNG. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) {
    c = (TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Время и дата MS-DOS: секунды — с шагом 2, годы — с 1980. */
function dosTime(d: Date): [time: number, date: number] {
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

const UTF8 = 0x0800;
const VERSION = 20;

/** Архив ZIP из файлов: локальные заголовки и данные, затем центральный каталог и его конец. */
export function zip(
  files: readonly ZipFile[],
  when = new Date(),
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const [time, date] = dosTime(when);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const data =
      typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, VERSION, true);
    l.setUint16(6, UTF8, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, VERSION, true);
    c.setUint16(6, VERSION, true);
    c.setUint16(8, UTF8, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    entry.set(name, 46);

    chunks.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, entry) => n + entry.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + size + end.length);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
