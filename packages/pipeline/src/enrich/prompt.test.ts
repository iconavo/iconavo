import { describe, expect, it } from "vitest";
import { CUSTOM_ID_LIMIT, EFFORT, MAX_TOKENS, MODEL } from "./config.js";
import {
  answerSchema,
  buildRequest,
  customId,
  SYSTEM_PROMPT,
  userText,
} from "./prompt.js";

const png = Buffer.from("png-bytes");

describe("запрос к модели", () => {
  it("модель, лимит токенов, усилие и строгий JSON; картинка раньше текста", () => {
    const r = buildRequest({
      setName: "Lucide",
      name: "house",
      tags: ["home", "building"],
      png,
    });
    expect(r.model).toBe(MODEL);
    expect(r.max_tokens).toBe(MAX_TOKENS);
    expect(r.system).toBe(SYSTEM_PROMPT);
    expect(r.output_config?.effort).toBe(EFFORT);
    expect(r.output_config?.format?.type).toBe("json_schema");
    // Мышление адаптивное по умолчанию, сэмплинг у Haiku 5.5 менять нельзя.
    expect(r).not.toHaveProperty("thinking");
    expect(r).not.toHaveProperty("temperature");
    const content = r.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const [image, text] = content as [unknown, unknown];
    expect(image).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: png.toString("base64"),
      },
    });
    expect(text).toEqual({
      type: "text",
      text: "Icon set: Lucide\nIcon name: house\nAuthor tags: home, building",
    });
  });

  it("без тегов автора — «none»", () => {
    expect(userText({ setName: "S", name: "a", tags: [] })).toContain(
      "Author tags: none",
    );
  });

  it("схема ответа: объекты закрыты, без min/max — их проверяет parse.ts", () => {
    const schema = answerSchema() as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<
        string,
        { additionalProperties: boolean; required: string[] }
      >;
    };
    expect(JSON.stringify(schema)).not.toMatch(
      /minItems|maxItems|minLength|maxLength/,
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["ru", "en"]);
    for (const lang of ["ru", "en"]) {
      expect(schema.properties[lang]?.additionalProperties).toBe(false);
      expect(schema.properties[lang]?.required).toEqual([
        "description",
        "synonyms",
      ]);
    }
  });

  it("custom_id — имя иконки, а слишком длинное имя — хэш в лимите пакета", () => {
    expect(customId("house")).toBe("house");
    const long = "a".repeat(CUSTOM_ID_LIMIT + 6);
    const id = customId(long);
    expect(id).toMatch(/^x-[0-9a-f]{20}$/);
    expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_LIMIT);
    expect(customId(long)).toBe(id);
  });
});
