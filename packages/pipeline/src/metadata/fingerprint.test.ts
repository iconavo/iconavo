import { describe, expect, it } from "vitest";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { fingerprint } from "./fingerprint.js";

const icon = (body: string, width = 24, height = 24): NormalizedIcon => ({
  body,
  width,
  height,
});

describe("отпечаток иконки", () => {
  it("12 символов 0-9 и a-f, одинаковый для одинаковой иконки", () => {
    const a = fingerprint("demo", "a", icon(`<path d="M0 0h24v24H0z"/>`));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprint("demo", "a", icon(`<path d="M0 0h24v24H0z"/>`))).toBe(a);
  });

  it("переименование иконки с ID отпечаток не меняет", () => {
    const body = (name: string) =>
      `<clipPath id="demo--${name}-0"><path d="M0 0h12v12H0z"/></clipPath><path clip-path="url(#demo--${name}-0)" d="M0 0h24v24H0z"/>`;
    expect(fingerprint("demo", "old-name", icon(body("old-name")))).toBe(
      fingerprint("demo", "new-name", icon(body("new-name"))),
    );
  });

  it("другое тело или другой размер — другой отпечаток", () => {
    const a = fingerprint("demo", "a", icon(`<path d="M0 0h24v24H0z"/>`));
    expect(
      fingerprint("demo", "a", icon(`<path d="M0 0h24v23H0z"/>`)),
    ).not.toBe(a);
    expect(
      fingerprint("demo", "a", icon(`<path d="M0 0h24v24H0z"/>`, 24, 25)),
    ).not.toBe(a);
  });
});
