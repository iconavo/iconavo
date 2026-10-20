import { describe, expect, it } from "vitest";
import type { BatchMessage } from "./batch.js";
import {
  normalizeSynonyms,
  parseAnswer,
  resultOutcome,
  SYNONYMS_MAX,
} from "./parse.js";

const good = {
  ru: {
    description: "  Дом с крышей —  главная страница. ",
    synonyms: ["Дом", "домик", "жильё", "главная", "home", "строение", "дом"],
  },
  en: {
    description: "A house: home page.",
    synonyms: [
      "home",
      "house",
      "building",
      "residence",
      "main page",
      "homepage",
      "dwelling",
    ],
  },
};

const message = (
  text: string,
  extra: Partial<BatchMessage> = {},
): BatchMessage => ({
  content: [{ type: "thinking" }, { type: "text", text }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
  ...extra,
});

describe("нормализация синонимов", () => {
  it("строчные буквы, без пробелов по краям, повторов, пустых и самого имени", () => {
    expect(
      normalizeSynonyms(
        [" Дом ", "дом", "Arrow  Left", "arrow-left", "", "arrow left", "x"],
        "arrow-left",
      ),
    ).toEqual(["дом", "x"]);
  });

  it("лишние сверх максимума отбрасываются", () => {
    const list = Array.from({ length: 14 }, (_, i) => `s${i}`);
    expect(normalizeSynonyms(list, "n")).toHaveLength(SYNONYMS_MAX);
  });
});

describe("разбор ответа", () => {
  it("текст берётся по типу блока, JSON чистится и проходит схему", () => {
    const r = parseAnswer(message(JSON.stringify(good)), "house", 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.promptVersion).toBe(1);
    expect(r.value.ru.description).toBe("Дом с крышей — главная страница.");
    expect(r.value.ru.synonyms).toEqual([
      "дом",
      "домик",
      "жильё",
      "главная",
      "home",
      "строение",
    ]);
    expect(r.value.en.synonyms).not.toContain("house");
  });

  it.each([
    [
      "отказ модели",
      message("{}", {
        stop_reason: "refusal",
        stop_details: { category: "general_harms" },
      }),
      /отказ модели \(general_harms\)/,
    ],
    [
      "ответ обрезан",
      message("{", { stop_reason: "max_tokens" }),
      /max_tokens/,
    ],
    [
      "нет текста",
      message("", { content: [{ type: "thinking" }] }),
      /нет текста/,
    ],
    ["не JSON", message("ok"), /не JSON/],
    [
      "лишний ключ",
      message(JSON.stringify({ ...good, extra: 1 })),
      /не по схеме/,
    ],
    [
      "мало синонимов",
      message(
        JSON.stringify({
          ...good,
          en: { ...good.en, synonyms: ["a", "b", "c", "d", "d"] },
        }),
      ),
      /en: синонимов 4, нужно 5–10/,
    ],
    [
      "пустое описание",
      message(
        JSON.stringify({ ...good, ru: { ...good.ru, description: " " } }),
      ),
      /ru: пустое описание/,
    ],
  ])("отказ: %s", (_name, msg, reason) => {
    const r = parseAnswer(msg, "house", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it("результат пакета: ошибка, отмена и истечение — отказ с причиной, успех — разбор", () => {
    expect(
      resultOutcome(
        {
          type: "errored",
          error: { error: { type: "invalid_request_error", message: "bad" } },
        },
        "a",
        1,
      ),
    ).toEqual({
      ok: false,
      reason: "ошибка запроса invalid_request_error: bad",
    });
    expect(resultOutcome({ type: "canceled" }, "a", 1)).toMatchObject({
      ok: false,
    });
    expect(resultOutcome({ type: "expired" }, "a", 1)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/истёк/),
    });
    expect(
      resultOutcome(
        { type: "succeeded", message: message(JSON.stringify(good)) },
        "house",
        2,
      ),
    ).toMatchObject({ ok: true, value: { promptVersion: 2 } });
  });
});
