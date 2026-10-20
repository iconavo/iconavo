import { changelogFileSchema } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import {
  changelogMarkdown,
  groupDigits,
  humanDate,
  isoDate,
  MARKDOWN_LIMIT,
  needsApproval,
  nextChangelog,
  secondsOf,
} from "./journal.js";
import { type HistoryChanges, noChanges } from "./merge.js";

/** 20 октября 2026, 09:00 UTC. */
const T1 = Date.UTC(2026, 9, 20, 9) / 1000;
const changes = (patch: Partial<HistoryChanges> = {}): HistoryChanges => ({
  ...noChanges(),
  ...patch,
});
const next = (patch: Partial<Parameters<typeof nextChangelog>[0]> = {}) =>
  nextChangelog({
    prefix: "demo",
    version: "11111111",
    revision: "1.0.0",
    total: 2,
    changes: changes(),
    now: T1,
    ...patch,
  });

const first = next();
const second = next({
  version: "22222222",
  previous: first.file,
  changes: changes({
    added: ["c"],
    hidden: ["b"],
    renamed: new Map([["x", "y"]]),
  }),
  now: T1 + 3600,
});

describe("следующий журнал", () => {
  it("первая запись: без прошлой версии, дата — сейчас", () => {
    expect(first.release).toBe("new");
    expect(first.file).toEqual({
      prefix: "demo",
      releases: [
        {
          version: "11111111",
          date: "2026-10-20T09:00:00Z",
          revision: "1.0.0",
          total: 2,
        },
      ],
    });
    expect(first.lastModified).toBe(T1);
    expect(changelogFileSchema.safeParse(first.file).success).toBe(true);
  });

  it("версия та же — журнал прошлой версии как есть", () => {
    const same = next({ previous: first.file, now: T1 + 100 });
    expect(same.release).toBe("same");
    expect(same.file).toBe(first.file);
    expect(same.lastModified).toBe(T1);
  });

  it("новая версия — выпуск сверху: прошлая версия, списки без пустых", () => {
    expect(second.release).toBe("new");
    expect(second.file.releases).toEqual([
      {
        version: "22222222",
        previous: "11111111",
        date: "2026-10-20T10:00:00Z",
        revision: "1.0.0",
        total: 2,
        added: ["c"],
        hidden: ["b"],
        renamed: { x: "y" },
      },
      first.file.releases[0],
    ]);
    expect(second.lastModified).toBe(T1 + 3600);
    expect(changelogFileSchema.safeParse(second.file).success).toBe(true);
  });

  it("дата не идёт назад: часы отстают — секунда после прошлого выпуска", () => {
    const r = next({
      version: "22222222",
      previous: first.file,
      now: T1 - 999,
    });
    expect(r.file.releases[0]?.date).toBe("2026-10-20T09:00:01Z");
  });

  it("журнал на диске с тем же выпуском — его дата; другой, чужой или сломанный — сейчас", () => {
    const again = (pending: unknown) =>
      next({
        version: "22222222",
        previous: first.file,
        pending,
        now: T1 + 7200,
      }).file.releases[0]?.date;
    expect(again(second.file)).toBe("2026-10-20T10:00:00Z");
    expect(again({ ...second.file, prefix: "other" })).toBe(
      "2026-10-20T11:00:00Z",
    );
    expect(again(first.file)).toBe("2026-10-20T11:00:00Z");
    expect(again("<<<<<<< HEAD")).toBe("2026-10-20T11:00:00Z");
    expect(again(undefined)).toBe("2026-10-20T11:00:00Z");
    // Первая запись тоже узнаёт себя: у обеих нет прошлой версии.
    expect(next({ pending: first.file, now: T1 + 50 }).file).toEqual(
      first.file,
    );
  });

  it("одобрение нужно только при скрытых или переименованных", () => {
    expect(needsApproval(second.file.releases[0] as never)).toBe(true);
    expect(needsApproval(first.file.releases[0] as never)).toBe(false);
    const added = next({
      version: "33333333",
      previous: first.file,
      changes: changes({ added: ["z"], aliases: new Map([["z-old", "z"]]) }),
    });
    expect(needsApproval(added.file.releases[0] as never)).toBe(false);
  });
});

describe("CHANGELOG.md", () => {
  it("легенда и выпуски от свежих к старым; скрытия и переименования — отдельным блоком", () => {
    const md = changelogMarkdown("Demo", second.file);
    expect(md).toBe(`# Журнал изменений — Demo

Выпуск — новая версия набора: она меняется, когда в \`icons.json\` меняется хоть что-то (ADR-0018).
Имена не пропадают: иконка, которую удалил автор, скрыта, но работает по имени, а старое имя переименованной ведёт на новое (ADR-0005).
Скрытия и переименования вы одобряете лично в pull request (ADR-0019). Полные списки — в \`changelog.json\`.

## 20 октября 2026 · версия 22222222

Прошлая версия: 11111111 · источник: 1.0.0 · иконок: 2.

**Требуют вашего одобрения**

- Скрыты — автор удалил, имя продолжает работать (1): \`b\`
- Переименованы — старое имя ведёт на новое (1): \`x\` → \`y\`

**Изменения**

- Добавлены (1): \`c\`

## 20 октября 2026 · версия 11111111

Начало журнала · источник: 1.0.0 · иконок: 2.
`);
    expect(changelogMarkdown("Demo", second.file)).toBe(md);
  });

  it("выпуск без перечисленных изменений объяснён; коммит — 7 символов", () => {
    const r = next({
      version: "33333333",
      previous: second.file,
      revision: "1ef60af944de207e0d5176905a0759ba12e6ee8d",
      total: 15753,
      now: T1 + 86400 * 3,
    });
    const md = changelogMarkdown("Demo", r.file);
    expect(md).toContain(
      "## 23 октября 2026 · версия 33333333\n\nПрошлая версия: 22222222 · источник: 1ef60af · иконок: 15 753.\n\nРисунки и имена не изменились — обновлён только файл набора.",
    );
  });

  it("длинные списки обрезаются, полный список — в changelog.json", () => {
    const many = Array.from(
      { length: MARKDOWN_LIMIT + 10 },
      (_, i) => `icon-${String(i).padStart(3, "0")}`,
    );
    const r = next({
      version: "33333333",
      previous: first.file,
      changes: changes({ added: many }),
    });
    expect(r.file.releases[0]?.added).toHaveLength(MARKDOWN_LIMIT + 10);
    const md = changelogMarkdown("Demo", r.file);
    expect(md).toContain(
      "`icon-049` … и ещё 10 — полный список в changelog.json",
    );
    expect(md).not.toContain("`icon-050`");
  });

  it("числа и даты не зависят от настроек системы", () => {
    expect([999, 1890, 15753, 1234567].map(groupDigits)).toEqual([
      "999",
      "1 890",
      "15 753",
      "1 234 567",
    ]);
    expect(humanDate("2026-01-01T00:00:00Z")).toBe("1 января 2026");
    expect(humanDate("2026-12-31T23:59:59Z")).toBe("31 декабря 2026");
    expect(isoDate(T1)).toBe("2026-10-20T09:00:00Z");
    expect(secondsOf(isoDate(T1 + 1))).toBe(T1 + 1);
  });
});
