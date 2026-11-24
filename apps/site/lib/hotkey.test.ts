import { describe, expect, it } from "vitest";
import { isSearchHotKey, type KeyLike } from "./hotkey";

const key = (init: Partial<KeyLike>): KeyLike => ({
  key: "k",
  code: "KeyK",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe("Ctrl K — поиск (ревизия фазы 5, С-2)", () => {
  it("Ctrl K и ⌘K — и в русской раскладке, где на клавише «л»", () => {
    expect(isSearchHotKey(key({ ctrlKey: true }))).toBe(true);
    expect(isSearchHotKey(key({ metaKey: true }))).toBe(true);
    expect(isSearchHotKey(key({ ctrlKey: true, key: "л" }))).toBe(true);
    expect(isSearchHotKey(key({ ctrlKey: true, key: "K" }))).toBe(true);
  });

  it("буква k на другом месте (Dvorak) — тоже; без Ctrl, с Alt или Shift — нет", () => {
    expect(isSearchHotKey(key({ ctrlKey: true, code: "KeyV" }))).toBe(true);
    expect(isSearchHotKey(key({}))).toBe(false);
    expect(isSearchHotKey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchHotKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchHotKey(key({ ctrlKey: true, key: "л", code: "KeyL" }))).toBe(
      false,
    );
  });
});
