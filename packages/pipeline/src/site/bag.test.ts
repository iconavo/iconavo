// Разбор ZIP проверки сайта против записи сайта (apps/site/lib/zip.ts): два независимых кода сходятся.

import { describe, expect, it } from "vitest";
import { zip } from "../../../../apps/site/lib/zip.js";
import { readZip, zipProblems } from "./bag.js";

const files = [
  {
    path: "README.txt",
    data: "Icons: Lucide by …\nLicense text: LICENSES/lucide.txt\n",
  },
  { path: "LICENSES/lucide.txt", data: "ISC License\n\nCopyright\n" },
  {
    path: "lucide/house.svg",
    data: '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  },
];

describe("ZIP сумки в проверке сайта (шаг 5 фазы 4)", () => {
  it("читает архив сайта: имена, данные, суммы", () => {
    const read = readZip(zip(files));
    expect(read.map((f) => f.path)).toEqual(files.map((f) => f.path));
    expect(read[1]?.data.toString("utf8")).toBe("ISC License\n\nCopyright\n");
  });

  it("испорченный байт — CRC не сходится", () => {
    const archive = zip(files);
    const at = Buffer.from(archive).indexOf("ISC");
    archive[at] = 0x58;
    expect(() => readZip(archive)).toThrow(/CRC не сходится/);
  });

  it("всё на месте — проблем нет; без текста лицензии — есть", () => {
    const expect_ = {
      icons: ["lucide:house"],
      licenses: { lucide: "ISC License\n\nCopyright\n" },
    };
    expect(zipProblems(readZip(zip(files)), expect_)).toEqual([]);
    expect(
      zipProblems(
        readZip(zip(files.filter((f) => !f.path.startsWith("LICENSES/")))),
        expect_,
      ),
    ).toEqual(["в ZIP нет полного текста лицензии lucide"]);
  });
});
