import { describe, expect, it } from "vitest";
import { counterpart, DICTIONARIES, href, LANGS, langOf } from "./i18n";

describe("языки сайта", () => {
  it("в словарях одни и те же ключи, строки не пустые", () => {
    const keys = Object.keys(DICTIONARIES.en).sort();
    for (const lang of LANGS) {
      const dict = DICTIONARIES[lang];
      expect(Object.keys(dict).sort()).toEqual(keys);
      for (const [key, text] of Object.entries(dict)) {
        expect(text.trim(), `${lang}.${key}`).not.toBe("");
      }
    }
  });

  it("русский словарь переведён, а не скопирован", () => {
    const same = Object.keys(DICTIONARIES.en).filter(
      (key) =>
        DICTIONARIES.en[key as keyof typeof DICTIONARIES.en] ===
        DICTIONARIES.ru[key as keyof typeof DICTIONARIES.ru],
    );
    expect(same).toEqual([]);
  });

  it("язык страницы — по адресу", () => {
    expect(langOf("/")).toBe("en");
    expect(langOf("/docs/reference")).toBe("en");
    expect(langOf("/ru")).toBe("ru");
    expect(langOf("/ru/search")).toBe("ru");
    expect(langOf("/rules")).toBe("en");
  });

  it("адрес на языке: у русского — /ru, документация — английская", () => {
    expect(href("en", "/")).toBe("/");
    expect(href("en", "/search")).toBe("/search");
    expect(href("ru", "/")).toBe("/ru");
    expect(href("ru", "/search")).toBe("/ru/search");
    expect(href("ru", "/docs")).toBe("/docs");
    expect(href("ru", "/docs/reference")).toBe("/docs/reference");
  });

  it("пара страницы на другом языке; у страниц без перевода — главная", () => {
    expect(counterpart("/")).toEqual({ lang: "ru", path: "/ru" });
    expect(counterpart("/search")).toEqual({ lang: "ru", path: "/ru/search" });
    expect(counterpart("/docs")).toEqual({ lang: "ru", path: "/ru" });
    expect(counterpart("/docs/api")).toEqual({ lang: "ru", path: "/ru" });
    expect(counterpart("/ru")).toEqual({ lang: "en", path: "/" });
    expect(counterpart("/ru/search")).toEqual({ lang: "en", path: "/search" });
  });
});
