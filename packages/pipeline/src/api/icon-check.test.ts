// Проверка /icon на настоящем обработчике функции (apps/api) с поддельными R2 и Meilisearch.

import { STORE_KEYS } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import {
  type FakeDoc,
  fakeBucket,
  fakeCache,
  fakeSearchFetch,
  MEILI_URL,
  manifestText,
  nameFileText,
  waiter,
} from "../../../../apps/api/src/fake.testing.js";
import { createHandler } from "../../../../apps/api/src/handler.js";
import { compactJson } from "../../../../apps/api/src/json.js";
import type { FetchFn } from "../sources/npm.js";
import { checkIcon, formatIconCheck, iconCheckFailed } from "./icon-check.js";

const V = { lucide: "0123abcd", ph: "4567cdef", fluent: "89abcdef" };
const CATALOG = "aaaaaaaaaaaa";
const LINE =
  '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g>';
const FILL = '<path fill="currentColor" d="M0 0h4v4H0z"/>';
const COLOR = '<path fill="#f00" d="M0 0h4v4H0z"/>';
const ABOUT = {
  en: { description: "A house", synonyms: ["home"] },
  ru: { description: "Дом", synonyms: ["жилище"] },
  tags: ["home"],
};
const TONES = ["light", "medium-light", "medium", "medium-dark", "dark"].map(
  (t) => `waving-hand-${t}`,
);

const info = (name: string, palette = false) => ({
  name,
  total: 1,
  version: "1.0.0",
  author: { name },
  license: { title: "MIT", spdx: "MIT" },
  height: 24,
  palette,
});
const LICENSE = {
  text: "MIT License",
  source: "https://example.com/demo",
  revision: "1.0.0",
};

const DOCS: FakeDoc[] = [
  {
    icon: "lucide:house",
    set: "lucide",
    names: ["house", "lucide:house"],
    words: ["house", "home"],
    style: ["outline"],
    styles: { outline: "house" },
    about: ABOUT,
  },
  {
    icon: "lucide:circle-alert",
    set: "lucide",
    names: [
      "alert-circle",
      "circle-alert",
      "lucide:alert-circle",
      "lucide:circle-alert",
    ],
    words: ["alert", "circle"],
    style: ["outline"],
    styles: { outline: "circle-alert" },
    about: ABOUT,
  },
  {
    icon: "ph:house",
    set: "ph",
    names: ["", "-bold", "-duotone", "-fill", "-light", "-thin"].flatMap(
      (s) => [`house${s}`, `ph:house${s}`],
    ),
    words: ["house", "home"],
    variants: [
      "house-bold",
      "house-duotone",
      "house-fill",
      "house-light",
      "house-thin",
    ],
    style: ["outline", "filled", "duotone"],
    styles: {
      outline: "house",
      filled: "house-fill",
      duotone: "house-duotone",
    },
    about: ABOUT,
  },
  {
    icon: "fluent:waving-hand",
    set: "fluent",
    names: ["waving-hand", ...TONES].flatMap((n) => [n, `fluent:${n}`]),
    words: ["wave"],
    tones: TONES,
    style: ["color"],
    styles: { color: "waving-hand" },
    about: ABOUT,
  },
];

/** Lucide 1.69.0: circle-alert стала circle-exclamation-point, оба старых имени — её алиасы. */
const RENAMED: FakeDoc = {
  icon: "lucide:circle-exclamation-point",
  set: "lucide",
  names: ["alert-circle", "circle-alert", "circle-exclamation-point"].flatMap(
    (n) => [n, `lucide:${n}`],
  ),
  words: ["alert", "circle", "exclamation", "point"],
  style: ["outline"],
  styles: { outline: "circle-exclamation-point" },
  about: ABOUT,
};

function world(
  o: { content?: boolean; about?: boolean; renamed?: boolean } = {},
) {
  const alert = o.renamed ? "circle-exclamation-point" : "circle-alert";
  const entry = (prefix: string, styles: object, extra: object = {}) => ({
    collection: "bbbbbbbbbbbb",
    info: info(prefix, prefix === "fluent"),
    license: LICENSE,
    ...(o.content === false ? {} : { content: "c0ffee000001" }),
    styles,
    ...extra,
  });
  const files: Record<string, string> = {
    "manifest.json": manifestText(V, CATALOG),
    [`catalog/${CATALOG}.json`]: compactJson({
      changelog: "dddddddddddd",
      sets: {
        lucide: entry(
          "lucide",
          { outline: [""] },
          {
            credits: [
              {
                name: "Feather",
                author: "Cole Bemis",
                url: "https://github.com/feathericons/feather",
                license: "MIT",
                icons: [alert],
              },
            ],
          },
        ),
        ph: entry("ph", {
          outline: ["-thin", "-light", "", "-bold"],
          filled: ["-fill"],
          duotone: ["-duotone"],
        }),
        fluent: entry("fluent", { color: [""] }),
      },
    }),
    [`v/${V.lucide}/lucide/house.json`]: nameFileText("lucide", {
      house: { body: LINE },
    }),
    [`v/${V.lucide}/lucide/alert-circle.json`]: nameFileText(
      "lucide",
      { [alert]: { body: LINE } },
      { "alert-circle": { parent: alert } },
    ),
    [`v/${V.lucide}/lucide/circle-parking.json`]: nameFileText("lucide", {
      "circle-parking": { body: LINE, hidden: true },
    }),
    [`v/${V.ph}/ph/house-bold.json`]: nameFileText("ph", {
      "house-bold": { body: FILL },
    }),
    [`v/${V.fluent}/fluent/waving-hand.json`]: nameFileText("fluent", {
      "waving-hand": { body: COLOR },
    }),
  };
  const base = o.renamed
    ? DOCS.map((d) => (d.icon === "lucide:circle-alert" ? RENAMED : d))
    : DOCS;
  const docs =
    o.about === false
      ? base.map(({ about: _, ...d }) => d)
      : base.map((d) => d);
  const net = fakeSearchFetch({ docs });
  const handler = createHandler({
    bucket: fakeBucket(files),
    cache: fakeCache(),
    build: "b1",
    search: {
      bucket: fakeBucket({
        [STORE_KEYS.index]: JSON.stringify({ version: "abcd1234" }),
      }),
      meili: { url: MEILI_URL, key: "k" },
      fetch: net.fn,
    },
  });
  const w = waiter();
  const fetchFn: FetchFn = async (input, init) => {
    const res = await handler(new Request(String(input), init), w.waitUntil);
    await w.flush();
    return res;
  };
  return { fetchFn };
}

// В подделке набор Fluent называется fluent: имена строк проверки — у живого API.
const live =
  (fetchFn: FetchFn): FetchFn =>
  (input, init) =>
    fetchFn(String(input).replace("fluent-emoji-flat:", "fluent:"), init);

describe("pnpm api check — сведения об иконке", () => {
  it("всё в порядке: карточка, алиас и Feather, варианты, оттенки, скрытая, ошибки", async () => {
    const { fetchFn } = world();
    const r = await checkIcon({
      fetch: live(fetchFn),
      sleep: async () => {},
      maxAttempts: 1,
    });
    expect(
      r.targets.filter((t) => t.issues.length > 0).map((t) => t.issues),
    ).toEqual([]);
    expect(iconCheckFailed(r)).toBe(false);
    expect(r.targets.map((t) => t.name)).toEqual([
      "Иконка",
      "Старое имя и Feather",
      "Варианты по таблице",
      "Оттенки кожи",
      "Скрытая",
      "Без icon",
      "Имя без набора",
      "Нет такой иконки",
    ]);
    expect(formatIconCheck(r).at(-1)).toBe(
      "Итог сведений об иконке: всё в порядке.",
    );
  });

  it("старое имя после переименования в Lucide (1.69.0) — тоже в порядке", async () => {
    const { fetchFn } = world({ renamed: true });
    const r = await checkIcon({
      fetch: live(fetchFn),
      sleep: async () => {},
      maxAttempts: 1,
    });
    const alias = r.targets.find((t) => t.name === "Старое имя и Feather");
    expect(alias?.issues).toEqual([]);
    expect(alias?.notes).toEqual([
      "основное имя: lucide:circle-exclamation-point",
    ]);
    expect(iconCheckFailed(r)).toBe(false);
  });

  it("алиас не привёл к основному имени — проблема", async () => {
    const { fetchFn } = world();
    // Ответ как есть, только icon — само старое имя: так ответила бы функция, не нашедшая родителя.
    const unresolved: FetchFn = async (input, init) => {
      const res = await fetchFn(input, init);
      if (!String(input).includes("icon=lucide:alert-circle")) return res;
      const body = (await res.json()) as Record<string, unknown>;
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      return new Response(
        JSON.stringify({ ...body, icon: "lucide:alert-circle" }),
        { status: res.status, headers },
      );
    };
    const r = await checkIcon({
      fetch: live(unresolved),
      sleep: async () => {},
      maxAttempts: 1,
    });
    const alias = r.targets.find((t) => t.name === "Старое имя и Feather");
    expect(alias?.issues.map((i) => i.message)).toEqual([
      "icon: lucide:alert-circle — алиас не привёл к основному имени Lucide",
    ]);
    expect(iconCheckFailed(r)).toBe(true);
  });

  it("каталог без отпечатка и индекс без about — проблемы с подсказкой", async () => {
    const { fetchFn } = world({ content: false, about: false });
    const r = await checkIcon({
      fetch: live(fetchFn),
      sleep: async () => {},
      maxAttempts: 1,
    });
    const first = r.targets[0]?.issues.map((i) => i.message) ?? [];
    expect(first.some((m) => m.startsWith("X-Iconavo-Content: нет"))).toBe(
      true,
    );
    expect(first.some((m) => m.startsWith("нет описаний ru/en"))).toBe(true);
    expect(iconCheckFailed(r)).toBe(true);
  });
});
