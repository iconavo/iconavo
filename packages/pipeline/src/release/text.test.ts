import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scriptUrl } from "./config.js";
import {
  addChangelogSection,
  changelogProblems,
  changelogSections,
  SRI_FORMAT,
  scriptRefs,
  setScriptRefs,
  sri,
} from "./text.js";

const HASH = sri("console.log(1)");

describe("хэш скрипта", () => {
  it("SHA-384 в base64, как у jsDelivr", () => {
    expect(HASH).toBe(
      `sha384-${createHash("sha384").update("console.log(1)").digest("base64")}`,
    );
    expect(HASH).toMatch(SRI_FORMAT);
    expect("sha256-abc").not.toMatch(SRI_FORMAT);
  });
});

describe("строка подключения скрипта", () => {
  const readme = [
    `<script type="module" src="${scriptUrl("0.1.0")}"></script>`,
    "",
    `  import { configure } from "${scriptUrl("0.1.0")}";`,
    `<script type="module" src="${scriptUrl("0.1.0")}" integrity="sha384-old" crossorigin="anonymous"></script>`,
  ].join("\n");

  it("находит версии адресов и хэши строк", () => {
    const refs = scriptRefs(readme);
    expect(refs.versions).toEqual(["0.1.0", "0.1.0", "0.1.0"]);
    expect(refs.tags).toEqual([
      { version: "0.1.0", attributes: "" },
      {
        version: "0.1.0",
        integrity: "sha384-old",
        attributes: 'integrity="sha384-old" crossorigin="anonymous"',
      },
    ]);
  });

  it("ставит версию во все адреса и один вид строки — src и integrity", () => {
    const next = setScriptRefs(readme, "0.2.0", HASH);
    const line = `<script type="module" src="${scriptUrl("0.2.0")}" integrity="${HASH}"></script>`;
    expect(next.split("\n")).toEqual([
      line,
      "",
      `  import { configure } from "${scriptUrl("0.2.0")}";`,
      line,
    ]);
    expect(setScriptRefs(next, "0.2.0", HASH)).toBe(next);
  });

  it("чужой адрес и другой пакет не трогает", () => {
    const text = `<script type="module" src="https://cdn.jsdelivr.net/npm/other@1.0.0/dist/iconavo-icon.js"></script>`;
    expect(scriptRefs(text).tags).toEqual([]);
    expect(setScriptRefs(text, "0.2.0", HASH)).toBe(text);
  });
});

const CHANGELOG = `# Changelog

Intro with \`code\`.

## 0.1.1 — 2026-11-02

- Fixed.

## 0.1.0 — 2026-10-29

The first beta.
`;

describe("журнал изменений", () => {
  it("разделы по порядку, текст без заголовка", () => {
    expect(changelogSections(CHANGELOG)).toEqual({
      sections: [
        { version: "0.1.1", date: "2026-11-02", body: "- Fixed." },
        { version: "0.1.0", date: "2026-10-29", body: "The first beta." },
      ],
      bad: [],
    });
  });

  it("новый раздел — перед первым, с заготовкой TODO", () => {
    const next = addChangelogSection(CHANGELOG, "0.2.0", "2026-11-10");
    expect(changelogSections(next).sections.map((s) => s.version)).toEqual([
      "0.2.0",
      "0.1.1",
      "0.1.0",
    ]);
    expect(next).toContain(
      "Intro with `code`.\n\n## 0.2.0 — 2026-11-10\n\n- TODO\n\n## 0.1.1",
    );
    expect(changelogProblems(next, "0.2.0")).toEqual([
      "журнал: в разделе 0.2.0 осталась заготовка TODO — допишите, что изменилось",
    ]);
  });

  it("та же версия первой — меняется только дата", () => {
    const next = addChangelogSection(CHANGELOG, "0.1.1", "2026-11-03");
    expect(next).toBe(CHANGELOG.replace("2026-11-02", "2026-11-03"));
  });

  it("журнал без разделов — раздел в конце", () => {
    expect(
      addChangelogSection("# Changelog\n\nIntro.\n", "0.1.0", "2026-10-29"),
    ).toBe("# Changelog\n\nIntro.\n\n## 0.1.0 — 2026-10-29\n\n- TODO\n");
  });

  it("выпуск этой версии: раздел первый, с текстом и верной датой", () => {
    expect(changelogProblems(CHANGELOG, "0.1.1")).toEqual([]);
    expect(changelogProblems(CHANGELOG, "0.2.0")).toEqual([
      "журнал: первый раздел — 0.1.1, а версия пакетов — 0.2.0",
    ]);
    expect(changelogProblems("# Changelog\n", "0.1.0")).toEqual([
      "журнал: нет раздела 0.1.0 — pnpm release bump 0.1.0",
    ]);
    expect(
      changelogProblems(CHANGELOG.replace("- Fixed.", ""), "0.1.1"),
    ).toEqual(["журнал: раздел 0.1.1 пуст"]);
  });

  it("неверный заголовок, дата и порядок — проблемы", () => {
    expect(
      changelogProblems(
        CHANGELOG.replace("## 0.1.0 — 2026-10-29", "## v0.1.0"),
        "0.1.1",
      ),
    ).toEqual([
      "журнал: заголовок «## v0.1.0» — нужен вид «## X.Y.Z — ГГГГ-ММ-ДД»",
    ]);
    expect(
      changelogProblems(CHANGELOG.replace("2026-11-02", "2026-02-30"), "0.1.1"),
    ).toEqual(["журнал: у раздела 0.1.1 неверная дата 2026-02-30"]);
    const swapped = `# Changelog\n\n## 0.1.0 — 2026-10-29\n\n- A.\n\n## 0.1.1 — 2026-11-02\n\n- B.\n`;
    expect(changelogProblems(swapped, "0.1.0")).toEqual([
      "журнал: разделы — не от новой версии к старой",
    ]);
  });

  it("«##» внутри блока кода — не раздел", () => {
    const text = `${CHANGELOG}\n\`\`\`md\n## not a section\n\`\`\`\n`;
    expect(changelogSections(text).bad).toEqual([]);
  });
});
