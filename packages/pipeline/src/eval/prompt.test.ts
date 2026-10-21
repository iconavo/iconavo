import { describe, expect, it } from "vitest";
import { JUDGE_MODEL } from "./config.js";
import type { GoldenQuery } from "./golden.js";
import { candidateLines, judgeBody, parseVerdicts } from "./prompt.js";

const query: GoldenQuery = {
  id: "en-009",
  query: "trash can",
  lang: "en",
  type: "object",
  description: "Мусорное ведро с крышкой.",
  split: "work",
};
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("запрос к судье", () => {
  it("одно сообщение: инструкция с запросом, затем номер, имя и картинка каждого кандидата", () => {
    const body = judgeBody(query, [
      { n: 1, name: "trash-2", png },
      { n: 2, name: "basket", png },
    ]);
    expect(body.model).toBe(JUDGE_MODEL);
    const content =
      (
        body.messages as {
          content: {
            type: string;
            text?: string;
            image_url?: { url: string; detail: string };
          }[];
        }[]
      )[0]?.content ?? [];
    expect(content[0]?.text).toContain(
      "Запрос: «trash can» (язык: английский).",
    );
    expect(content[0]?.text).toContain("Ожидание: Мусорное ведро с крышкой.");
    expect(content.slice(1).map((p) => p.type)).toEqual([
      "text",
      "image_url",
      "text",
      "image_url",
    ]);
    expect(content[2]?.image_url).toEqual({
      url: `data:image/png;base64,${png.toString("base64")}`,
      detail: "low",
    });
    expect(candidateLines(body)).toEqual([
      { n: 1, name: "trash-2" },
      { n: 2, name: "basket" },
    ]);
    expect(body.response_format).toMatchObject({ type: "json_schema" });
  });
});

describe("ответ судьи", () => {
  it("JSON, можно в обёртке ```json", () => {
    const text =
      '```json\n{"verdicts":[{"n":2,"verdict":"no"},{"n":1,"verdict":"fits"}]}\n```';
    expect([...parseVerdicts(text, [1, 2])]).toEqual([
      [2, "no"],
      [1, "fits"],
    ]);
  });

  it("ровно один вердикт на каждый номер", () => {
    const v = (list: unknown[]) => JSON.stringify({ verdicts: list });
    expect(() => parseVerdicts(v([{ n: 1, verdict: "fits" }]), [1, 2])).toThrow(
      /про 1 кандидатов из 2/,
    );
    expect(() =>
      parseVerdicts(
        v([
          { n: 1, verdict: "fits" },
          { n: 1, verdict: "no" },
        ]),
        [1],
      ),
    ).toThrow(/дважды/);
    expect(() => parseVerdicts(v([{ n: 3, verdict: "fits" }]), [1])).toThrow(
      /номер «3»/,
    );
    expect(() => parseVerdicts(v([{ n: 1, verdict: "maybe" }]), [1])).toThrow(
      /вердикт «maybe»/,
    );
    expect(() => parseVerdicts("не JSON", [1])).toThrow(/не JSON/);
    expect(() => parseVerdicts("{}", [1])).toThrow(/нет verdicts/);
  });
});
