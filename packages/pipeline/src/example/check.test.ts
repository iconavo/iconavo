import { describe, expect, it } from "vitest";
import {
  canaryVerdict,
  consoleVerdict,
  type ExampleNames,
  expectedWarnings,
  networkVerdict,
  type Placeholder,
  placeholderVerdict,
  requested,
} from "./check.js";

const API = "http://127.0.0.1:5000";

const NAMES: ExampleNames = {
  server: ["lucide:house"],
  browser: ["lucide:cat", "ph:fish"],
  toggle: [],
  more: [],
  moreBrowser: [],
  tag: "lucide:search",
  missing: "lucide:no-such-icon",
  missingTag: "lucide:no-such-tag-icon",
};

describe("запросы к хостам иконок", () => {
  it("имена из пачек API, статика — счётом, чужие адреса не в счёт", () => {
    expect(
      requested(
        [
          `${API}/lucide.json?icons=cat,search`,
          `${API}/ph.json?icons=fish`,
          `${API}/_static/manifest.json`,
          "http://127.0.0.1:4283/more",
        ],
        API,
      ),
    ).toEqual({
      names: ["lucide:cat", "lucide:search", "ph:fish"],
      batches: 2,
      statics: 1,
    });
  });

  it("сеть: иконки обёртки, повторы, пропуски и статика — проблемы", () => {
    const expected = [...NAMES.browser, NAMES.tag];
    expect(
      networkVerdict(
        [`${API}/lucide.json?icons=cat,search`, `${API}/ph.json?icons=fish`],
        API,
        NAMES.server,
        expected,
      ).ok,
    ).toBe(true);
    const bad = networkVerdict(
      [
        `${API}/lucide.json?icons=cat,house`,
        `${API}/lucide.json?icons=cat`,
        `${API}/_static/manifest.json`,
      ],
      API,
      NAMES.server,
      expected,
    );
    expect(bad.ok).toBe(false);
    expect(bad.note).toContain("запрошены иконки обёртки: lucide:house");
    expect(bad.note).toContain("дважды: lucide:cat");
    expect(bad.note).toContain("не запрошены: ph:fish, lucide:search");
    expect(bad.note).toContain("запросов к статике: 1");
  });
});

describe("заглушки", () => {
  const p = (over: Partial<Placeholder>): Placeholder => ({
    name: "lucide:cat",
    className: "iconavo-skeleton",
    drawn: false,
    visibility: "visible",
    animation: "iconavo-h, iconavo-p",
    ...over,
  });

  it("видны и анимированы: скелетон мерцает, спиннер крутится; ранний замер — сколько было скрыто", () => {
    const late = [
      p({}),
      p({ className: "iconavo-spinner", animation: "iconavo-h, iconavo-s" }),
    ];
    const v = placeholderVerdict(
      late.map((x) => ({ ...x, visibility: "hidden" })),
      late,
    );
    expect(v.ok).toBe(true);
    expect(v.note).toContain("скелетон и спиннер");
    expect(v.note).toContain("скрыто 2 из 2");
  });

  it("скрытая или неподвижная заглушка — проблема; все иконки уже пришли — только сведения", () => {
    expect(placeholderVerdict([], [p({ visibility: "hidden" })]).ok).toBe(
      false,
    );
    expect(
      placeholderVerdict(
        [],
        [
          p({
            className: "iconavo-spinner",
            animation: "iconavo-h, iconavo-p",
          }),
        ],
      ).ok,
    ).toBe(false);
    expect(placeholderVerdict([], [p({ drawn: true })]).ok).toBeNull();
  });
});

describe("консоль", () => {
  const expected = expectedWarnings(NAMES);

  it("два ожидаемых предупреждения — по разу, больше ничего", () => {
    expect(expected).toEqual([
      'Iconavo: icon "lucide:no-such-icon" not found',
      'Iconavo: icon "lucide:no-such-tag-icon" not found',
    ]);
    expect(consoleVerdict(expected, [], expected).ok).toBe(true);
  });

  it("лишнее предупреждение, повтор и ошибка гидратации — проблемы", () => {
    const v = consoleVerdict(
      [...expected, expected[0] as string, "A tree hydrated but…"],
      ["Hydration failed"],
      expected,
    );
    expect(v.ok).toBe(false);
    expect(v.note).toContain("2 раз:");
    expect(v.note).toContain("предупреждение: A tree hydrated but…");
    expect(v.note).toContain("ошибка: Hydration failed");
  });

  it("контрольный запуск: сказано про гидратацию — да; тишина или чужая ошибка — проверка слепая", () => {
    expect(
      canaryVerdict(["noise", "Minified React error #418; visit…"]).note,
    ).toContain("#418");
    expect(canaryVerdict([]).ok).toBe(false);
    const other = canaryVerdict(["WebSocket connection failed"]);
    expect(other.ok).toBe(false);
    expect(other.note).toContain("было: WebSocket connection failed");
  });
});
