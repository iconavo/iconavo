import { STORE_KEYS } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import { fakeBucket } from "../fake.testing.js";
import {
  indexVersionLoader,
  NO_INDEX,
  UNKNOWN_INDEX,
} from "./index-version.js";

/** Обещание, которое обязано выполниться быстро: зависло — ошибка теста, а не вечное ожидание. */
const within = <T>(promise: Promise<T>, ms = 300): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`не дождались за ${ms} мс`)), ms),
    ),
  ]);

const VERSION_TEXT = JSON.stringify({ version: "0123abcd" });

function setup() {
  const bucket = fakeBucket({ [STORE_KEYS.index]: VERSION_TEXT });
  let time = 0;
  const logs: string[] = [];
  const load = indexVersionLoader(
    bucket,
    () => time,
    (m) => logs.push(m),
  );
  return {
    bucket,
    load,
    logs,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("indexVersionLoader", () => {
  it("версия из index.json — на минуту; бакет не ответил — прежняя, без неё — «unknown» (ревизия фазы 5, А-14)", async () => {
    const { bucket, load, advance, logs } = setup();
    expect(await load()).toBe("0123abcd");
    advance(59_999);
    await load();
    expect(bucket.reads).toHaveLength(1);
    advance(1);
    bucket.failing.add("*");
    expect(await load()).toBe("0123abcd");
    expect(logs).toHaveLength(1);
    const fresh = setup();
    fresh.bucket.failing.add("*");
    expect(await fresh.load()).toBe(UNKNOWN_INDEX);
    expect(UNKNOWN_INDEX).not.toBe(NO_INDEX);
  });

  it("после сбоя — пауза: 10 секунд бакет не читается, затем снова (ревизия фазы 5, А-15)", async () => {
    const { bucket, load, advance } = setup();
    bucket.failing.add("*");
    expect(await load()).toBe(UNKNOWN_INDEX);
    expect(bucket.reads).toHaveLength(1);
    advance(9_999);
    expect(await load()).toBe(UNKNOWN_INDEX);
    expect(bucket.reads).toHaveLength(1);
    bucket.failing.clear();
    advance(1);
    expect(await load()).toBe("0123abcd");
    expect(bucket.reads).toHaveLength(2);
  });

  // 18 ноября 2026: живой API отвечал 500 «This promise was created by a request that has since ended».
  // Запрос, начавший загрузку, оборвался, а другой ждал его загрузку — в workerd так нельзя.
  it("загрузка оборванного запроса не держит другие: и холодная копия, и обновление через минуту", async () => {
    const { bucket, load, advance } = setup();
    bucket.stuck.add(STORE_KEYS.index);
    void load();
    expect(await within(load())).toBe("0123abcd");
    advance(60_000);
    bucket.stuck.add(STORE_KEYS.index);
    void load();
    expect(await within(load())).toBe("0123abcd");
  });
});
