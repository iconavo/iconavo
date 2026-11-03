import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, zip } from "./zip";

/** Записи архива по центральному каталогу: имя, флаги, метод, CRC, данные из локального заголовка. */
function entries(archive: Uint8Array) {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const end = archive.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const out: {
    path: string;
    flags: number;
    method: number;
    crc: number;
    data: Uint8Array;
  }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(
      archive.subarray(at + 46, at + 46 + nameLength),
    );
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    out.push({
      path,
      flags,
      method,
      crc,
      data: archive.subarray(start, start + size),
    });
    at += 46 + nameLength;
  }
  return out;
}

describe("ZIP сумки (шаг 5 фазы 4)", () => {
  it("CRC-32 — как у zlib", () => {
    for (const text of ["", "a", "iconavo", "Сумка 👜", "x".repeat(10_000)]) {
      const bytes = new TextEncoder().encode(text);
      expect(crc32(bytes), text.slice(0, 10)).toBe(zlibCrc32(bytes));
    }
  });

  it("файлы без сжатия, имена в UTF-8, данные и суммы — на месте", () => {
    const archive = zip(
      [
        { path: "README.txt", data: "Icons from Iconavo" },
        { path: "LICENSES/лицензия.txt", data: "MIT" },
        { path: "lucide/house.svg", data: new Uint8Array([60, 115, 118, 103]) },
      ],
      new Date(2026, 10, 3, 14, 30, 10),
    );
    const files = entries(archive);
    expect(files.map((f) => f.path)).toEqual([
      "README.txt",
      "LICENSES/лицензия.txt",
      "lucide/house.svg",
    ]);
    for (const f of files) {
      expect(f.method).toBe(0);
      expect(f.flags & 0x0800).toBe(0x0800);
      expect(f.crc).toBe(zlibCrc32(f.data));
    }
    expect(new TextDecoder().decode(files[0]?.data)).toBe("Icons from Iconavo");
    expect([...(files[2]?.data ?? [])]).toEqual([60, 115, 118, 103]);
  });

  it("дата и время MS-DOS — в заголовках", () => {
    const archive = zip(
      [{ path: "a.txt", data: "a" }],
      new Date(2026, 10, 3, 14, 30, 10),
    );
    const view = new DataView(archive.buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (30 << 5) | 5);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 3);
  });
});
