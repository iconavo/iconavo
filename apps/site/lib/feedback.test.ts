import { describe, expect, it } from "vitest";
import {
  browserOf,
  FEEDBACK_LIMITS,
  feedbackErrorOf,
  pageOf,
  SCREENSHOT,
  screenshotProblem,
} from "./feedback";

describe("обратная связь (PR 6а)", () => {
  it("браузер — имя, главная версия и система, без остальной строки агента", () => {
    expect(
      browserOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 131 · Windows");
    expect(
      browserOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      ),
    ).toBe("Safari 18.1 · macOS");
    expect(
      browserOf(
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
      ),
    ).toBe("Firefox 133 · Linux");
    expect(
      browserOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70",
      ),
    ).toBe("Edge 131 · Windows");
    expect(
      browserOf(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 18.1 · iOS");
    expect(browserOf("curl/8.0")).toBe("Unknown browser");
  });

  it("страница — без служебных параметров аккаунта и якоря; длинная — без параметров", () => {
    expect(
      pageOf("https://iconavo.dev/lucide?accounts=on&icon=lucide:house#top"),
    ).toBe("https://iconavo.dev/lucide?icon=lucide%3Ahouse");
    const long = `https://iconavo.dev/search?q=${"a".repeat(400)}`;
    expect(pageOf(long)).toBe("https://iconavo.dev/search");
    expect(pageOf(long).length).toBeLessThanOrEqual(FEEDBACK_LIMITS.short);
  });

  it("скриншот — PNG или JPEG, не пустой и не больше 5 МБ", () => {
    expect(screenshotProblem({ type: "image/png", size: 1000 })).toBe(false);
    expect(
      screenshotProblem({ type: "image/jpeg", size: SCREENSHOT.maxBytes }),
    ).toBe(false);
    expect(screenshotProblem({ type: "image/gif", size: 1000 })).toBe(true);
    expect(screenshotProblem({ type: "image/png", size: 0 })).toBe(true);
    expect(
      screenshotProblem({ type: "image/png", size: SCREENSHOT.maxBytes + 1 }),
    ).toBe(true);
  });

  it("ошибки сервиса — к своему полю или под формой", () => {
    expect(feedbackErrorOf("TEXT_REQUIRED")).toEqual({
      field: "text",
      message: "feedbackErrorText",
    });
    expect(feedbackErrorOf("UNSUPPORTED_IMAGE").field).toBe("file");
    expect(feedbackErrorOf("TOO_MANY_MESSAGES")).toEqual({
      message: "feedbackErrorTooMany",
    });
    expect(feedbackErrorOf("SEND_FAILED").message).toBe("feedbackErrorSend");
    expect(feedbackErrorOf("NETWORK").field).toBeUndefined();
  });
});
