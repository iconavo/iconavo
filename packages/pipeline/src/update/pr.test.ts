import { describe, expect, it } from "vitest";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { decide, isDowngrade } from "./decide.js";
import {
  BODY_LIMIT,
  PR_LABELS,
  type PrInput,
  prMarker,
  prText,
  revisionName,
} from "./pr.js";
import type { SetSummary } from "./summary.js";

const OLD = "1ef60af944de207e0d5176905a0759ba12e6ee8d";
const NEW = "02eb9161b57917ccaa262f1bf070507cddde3b08";
const TAGS = new Map([
  [OLD, "1.59.0"],
  [NEW, "1.60.0"],
]);

const common: Omit<SourceConfigInput, "id" | "name" | "source"> = {
  author: { name: "Demo" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: { spdx: "ISC", file: "LICENSE" },
};
const lucide = sourceConfigSchema.parse({
  ...common,
  id: "lucide",
  name: "Lucide",
  source: {
    type: "git",
    repo: "https://github.com/lucide-icons/lucide",
    latest: "tag",
  },
});
const tabler = sourceConfigSchema.parse({
  ...common,
  id: "tabler",
  name: "Tabler Icons",
  source: { type: "npm", package: "@tabler/icons" },
  license: { spdx: "MIT", file: "LICENSE" },
});
const npm = (version: string): LockEntry => ({
  type: "npm",
  version,
  integrity: "sha512-AAAA",
});
const git = (commit: string): LockEntry => ({ type: "git", commit });

const BASE: SetSummary = {
  id: "lucide",
  name: "Lucide",
  source: "https://github.com/lucide-icons/lucide@02eb916",
  entry: git(NEW),
  written: true,
  stop: [],
  excluded: [],
  release: {
    status: "new",
    version: "ebb52e13",
    previous: "bf94bc18",
    total: 1899,
    changes: {
      added: 2,
      changed: 1,
      restored: 0,
      hidden: 0,
      renamed: 0,
      aliases: 0,
    },
    needsApproval: false,
    top: {
      version: "ebb52e13",
      previous: "bf94bc18",
      date: "2026-10-20T12:00:00Z",
      revision: NEW,
      total: 1899,
      added: ["avocado", "bacon"],
      changed: ["brain"],
    },
  },
  qc: {
    checked: 1899,
    counts: {
      failed: 0,
      empty: 0,
      sparse: 0,
      cropped: 0,
      changed: 0,
      original: 0,
    },
    attention: [],
  },
  license: { spdx: "ISC", status: "confirmed", hash: "a".repeat(64) },
};

type Patch = Omit<Partial<SetSummary>, "release" | "qc" | "license"> & {
  release?: Partial<SetSummary["release"]>;
  qc?: Partial<SetSummary["qc"]>;
  license?: Partial<SetSummary["license"]>;
};
const summary = (p: Patch = {}): SetSummary => ({
  ...BASE,
  ...p,
  release: { ...BASE.release, ...p.release },
  qc: { ...BASE.qc, ...p.qc },
  license: { ...BASE.license, ...p.license },
});
const changes = (patch: Partial<SetSummary["release"]["changes"]>) => ({
  ...BASE.release.changes,
  ...patch,
});
/** Выпуска нет: рисунки и имена те же, обновилась только версия источника. */
const SAME: Partial<SetSummary["release"]> = {
  status: "same",
  top: undefined,
  changes: {
    added: 0,
    changed: 0,
    restored: 0,
    hidden: 0,
    renamed: 0,
    aliases: 0,
  },
};
const EMPTY_STOP = "пустые иконки: 1 — закрашено меньше 0,05% холста";
const LICENSE_STOP =
  "лицензия изменилась у автора: подтверждён текст 8a1de583a86b…, сейчас 1234abcd5678…";

const pr = (patch: Patch = {}, input: Partial<PrInput> = {}) =>
  prText({
    config: lucide,
    summary: summary(patch),
    before: git(OLD),
    tags: TAGS,
    ...input,
  });

describe("решение по PR робота", () => {
  it("сборка остановилась — проблема, причины — строки «СТОП»", () => {
    const v = decide(summary({ written: false, stop: [EMPTY_STOP] }), git(OLD));
    expect(v).toEqual({
      decision: "problem",
      reasons: [EMPTY_STOP],
      licenseOnly: false,
    });
  });

  it("остановила только лицензия — ждёт одобрения, а не проблема", () => {
    const v = decide(
      summary({
        written: false,
        stop: [LICENSE_STOP],
        license: { status: "changed" },
      }),
      git(OLD),
    );
    expect(v.decision).toBe("approval");
    expect(v.licenseOnly).toBe(true);
    expect(v.reasons[0]).toMatch(/лицензия изменилась у автора/);
  });

  it("лицензия и пустые иконки вместе — проблема", () => {
    const v = decide(
      summary({
        written: false,
        stop: [EMPTY_STOP, LICENSE_STOP],
        license: { status: "changed" },
      }),
      git(OLD),
    );
    expect(v.decision).toBe("problem");
    expect(v.licenseOnly).toBe(false);
  });

  it("скрытия и переименования — ждёт одобрения", () => {
    const v = decide(
      summary({
        release: {
          needsApproval: true,
          changes: changes({ hidden: 2, renamed: 1 }),
        },
      }),
      git(OLD),
    );
    expect(v.decision).toBe("approval");
    expect(v.reasons).toEqual([
      "скрыты 2 — автор их удалил",
      "переименованы 1",
    ]);
  });

  it("новые находки контроля и исключённые иконки — ждёт одобрения", () => {
    expect(
      decide(
        summary({
          qc: {
            attention: [{ kind: "cropped", name: "x", text: "вылет 3%" }],
          },
        }),
        git(OLD),
      ).decision,
    ).toBe("approval");
    expect(
      decide(
        summary({ excluded: [{ name: "x", reason: "очистка: не SVG" }] }),
        git(OLD),
      ).reasons,
    ).toEqual([
      "исключены при очистке: 1 — у автора они есть, а в наборе их не будет",
    ]);
  });

  it("версия стала меньше — ждёт одобрения; 3.9.0 → 3.10.0 — не откат", () => {
    expect(isDowngrade(npm("3.50.0"), npm("3.49.0"))).toBe(true);
    expect(isDowngrade(npm("3.9.0"), npm("3.10.0"))).toBe(false);
    expect(isDowngrade(undefined, npm("1.0.0"))).toBe(false);
    // git: сравниваются теги выпусков; у коммитов без тега порядка нет.
    expect(isDowngrade(git(NEW), git(OLD), TAGS)).toBe(true);
    expect(isDowngrade(git(OLD), git(NEW), TAGS)).toBe(false);
    expect(isDowngrade(git(NEW), git(OLD))).toBe(false);
    const v = decide(summary({ entry: npm("3.49.0") }), npm("3.50.0"));
    expect(v).toEqual({
      decision: "approval",
      reasons: ["версия у автора стала меньше: 3.50.0 → 3.49.0"],
      licenseOnly: false,
    });
    expect(
      decide(summary({ entry: git(OLD) }), git(NEW), TAGS).reasons,
    ).toEqual(["версия у автора стала меньше: 1.60.0 → 1.59.0"]);
  });

  it("иконки только добавлены и изменены или выпуска нет — сольётся сам", () => {
    expect(decide(summary(), git(OLD)).decision).toBe("auto");
    expect(
      decide(
        summary({
          release: SAME,
        }),
        git(OLD),
      ).decision,
    ).toBe("auto");
  });
});

describe("текст PR робота", () => {
  it("заголовок: теги выпусков, версии npm, хэши без тегов", () => {
    expect(pr().title).toBe("Lucide 1.59.0 → 1.60.0: добавлено 2, изменено 1");
    expect(
      pr(
        { entry: npm("3.50.0") },
        { config: tabler, before: npm("3.49.0"), tags: undefined },
      ).title,
    ).toBe("Tabler Icons 3.49.0 → 3.50.0: добавлено 2, изменено 1");
    expect(pr({}, { tags: undefined }).title).toBe(
      "Lucide 1ef60af → 02eb916: добавлено 2, изменено 1",
    );
    expect(revisionName(git(NEW))).toBe("02eb916");
    expect(revisionName(git(NEW), TAGS)).toBe("1.60.0");
  });

  it("заголовок: иконки не изменились, сборка остановилась, новая лицензия", () => {
    expect(pr({ release: SAME }).title).toBe(
      "Lucide 1.59.0 → 1.60.0: иконки не изменились",
    );
    expect(pr({ written: false, stop: [EMPTY_STOP] }).title).toBe(
      "Lucide 1.59.0 → 1.60.0: сборка остановилась",
    );
    expect(
      pr({
        written: false,
        stop: [LICENSE_STOP],
        license: { status: "changed" },
      }).title,
    ).toBe("Lucide 1.59.0 → 1.60.0: новая лицензия, добавлено 2, изменено 1");
  });

  it("описание: метка версии первой строкой, вердикт, ссылки на источник, журнал на уровень ниже", () => {
    const { body, marker } = pr();
    expect(marker).toBe(`iconavo-bot:lucide@${NEW}`);
    expect(body.split("\n")[0]).toBe(`<!-- ${marker} -->`);
    expect(body).toContain(
      "**Сольётся сам**, когда пройдут проверки «CI» и «Данные»: иконки только добавлены или изменены.",
    );
    expect(body).toContain(
      `Lucide \`1.59.0\` → \`1.60.0\` · [выпуск 1.60.0 у автора](https://github.com/lucide-icons/lucide/releases/tag/1.60.0) · [изменения в источнике](https://github.com/lucide-icons/lucide/compare/${OLD}...${NEW})`,
    );
    expect(body).toContain(
      "### Журнал\n\n#### 20 октября 2026 · версия ebb52e13",
    );
    expect(body).not.toMatch(/^## /m);
    expect(body).toContain("- Добавлены (2): `avocado`, `bacon`");
    expect(body).toContain("ISC — текст тот же, что вы подтвердили.");
    expect(body.endsWith("робот её больше не трогает.\n")).toBe(true);
  });

  it("пакет npm — ссылка на версию в реестре", () => {
    const { body } = pr(
      { entry: npm("3.50.0") },
      { config: tabler, before: npm("3.49.0"), tags: undefined },
    );
    expect(body).toContain(
      "Tabler Icons `3.49.0` → `3.50.0` · пакет [`@tabler/icons@3.50.0`](https://www.npmjs.com/package/@tabler/icons/v/3.50.0)",
    );
  });

  it("раздел «Отчёты» — только с переданными ссылками", () => {
    expect(pr().body).not.toContain("### Отчёты");
    const { body } = pr(
      {},
      {
        links: {
          run: "https://github.com/iconavo/iconavo/actions/runs/1",
          qc: "https://github.com/iconavo/iconavo/actions/runs/1/artifacts/3",
        },
      },
    );
    expect(body).toContain(
      "- [Контроль качества](https://github.com/iconavo/iconavo/actions/runs/1/artifacts/3)",
    );
    expect(body).toContain(
      "- [Запуск робота](https://github.com/iconavo/iconavo/actions/runs/1)",
    );
    expect(body).not.toContain("Что изменилось, с картинками");
  });

  it("что делать: лицензия — подтверждение в ветке PR; пустые иконки — отчёт контроля", () => {
    const license = pr({
      written: false,
      stop: [LICENSE_STOP],
      license: { status: "changed", hash: "1234abcd5678".padEnd(64, "0") },
    }).body;
    expect(license).toContain("**Ждёт вашего одобрения:**");
    expect(license).toContain("«подтверждаю лицензию Lucide из PR робота»");
    expect(license).toContain("`sources/lucide.ts`");
    expect(license).toContain("Новый отпечаток: `1234abcd5678…`.");
    expect(license).toContain("Так выглядел бы выпуск, если бы сборка прошла:");

    const empty = pr({
      written: false,
      stop: [EMPTY_STOP],
      qc: { counts: { ...BASE.qc.counts, empty: 1 } },
    }).body;
    expect(empty).toContain(
      "**Проблема: сборка остановилась** — слить нельзя.",
    );
    expect(empty).toContain(`- ${EMPTY_STOP}`);
    expect(empty).toContain("там пустые или ненарисованные иконки");
  });

  it("находки и исключённые перечислены с пределом", () => {
    const attention = Array.from({ length: 35 }, (_, i) => ({
      kind: "sparse" as const,
      name: `dot-${i}`,
      text: "закрашено 0,3%",
    }));
    const { body } = pr({ qc: { attention } });
    expect(body).toContain("- `lucide:dot-0` — почти пустая: закрашено 0,3%");
    expect(body).not.toContain("`lucide:dot-30`");
    expect(body).toContain("- … и ещё 5 — в отчёте");
  });

  it("длинный журнал заменяется ссылкой; описание не длиннее предела", () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `icon-${i}-${"x".repeat(1200)}`,
    );
    const top = BASE.release.top;
    if (!top) throw new Error("нет выпуска");
    const replaced = pr({ release: { top: { ...top, added: long } } }).body;
    expect(replaced.length).toBeLessThanOrEqual(BODY_LIMIT);
    expect(replaced).toContain("Выпуск большой и в описание не поместился");

    const cut = pr({ written: false, stop: ["x".repeat(70_000)] }).body;
    expect(cut.length).toBeLessThanOrEqual(BODY_LIMIT + 100);
    expect(cut).toContain("описание обрезано");
  });

  it("«@» в тексте не упоминает чужие организации на GitHub", () => {
    const { body } = pr(
      {
        entry: npm("3.50.0"),
        written: false,
        stop: ["источник @tabler/icons@3.50.0 не читается"],
      },
      { config: tabler, before: npm("3.49.0"), tags: undefined },
    );
    // Упоминания не работают в коде, в адресах ссылок и в комментариях — остальной текст.
    const plain = body
      .replace(/`[^`]*`/g, "")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/<!--.*?-->/g, "");
    expect(plain).not.toMatch(/@[A-Za-z0-9]/);
    expect(body).toContain("источник @​tabler/icons@​3.50.0");
  });

  it("метки по решению; без автослияния — ждёт вас", () => {
    expect(pr().labels).toEqual([PR_LABELS.bot]);
    expect(
      pr({ release: { needsApproval: true, changes: changes({ hidden: 1 }) } })
        .labels,
    ).toEqual([PR_LABELS.bot, PR_LABELS.approval]);
    expect(pr({ written: false, stop: [EMPTY_STOP] }).labels).toEqual([
      PR_LABELS.bot,
      PR_LABELS.problem,
    ]);
    const manual = pr({}, { autoMerge: false });
    expect(manual.autoMerge).toBe(false);
    expect(manual.decision).toBe("auto");
    expect(manual.verdict).toBe("ждёт вас: автослияние выключено");
    expect(manual.body).toContain("**Ждёт вас**");
    expect(pr().autoMerge).toBe(true);
    expect(pr().verdict).toBe("сольётся сам");
  });

  it("метка версии — та строка, которую ищет update.yml", () => {
    expect(prMarker("lucide", git(NEW))).toBe(`iconavo-bot:lucide@${NEW}`);
    expect(prMarker("tabler", npm("3.50.0"))).toBe("iconavo-bot:tabler@3.50.0");
    expect(pr().commitBody).toBe(
      "Автообновление (ADR-0019): sources.lock.json и data/lucide/. Журнал — data/lucide/CHANGELOG.md.",
    );
  });
});
