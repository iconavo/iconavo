// Обратная связь на сайте (шаг 3 фазы 5, PR 6а; кадры K1–K6 макета «Личный кабинет»): окна из меню
// аккаунта — ошибка со скриншотом, запрос иконок, запрос функции и отзыв со звёздами. Отправка — форма
// multipart на POST /api/account/feedback сервиса аккаунтов (apps/account/src/feedback.ts): письмо уходит
// на support@iconavo.dev, ответ — человеку на его почту.

import { useSyncExternalStore } from "react";
import {
  type MessageKey,
  messageOf,
  type Reply,
  request,
  withoutAccountParams,
} from "./account";
import { menuStore } from "./menu";
import { createPanelStore } from "./panel-store";

export const FEEDBACK_KINDS = ["bug", "icons", "feature", "feedback"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Скриншот — PNG или JPEG до 5 МБ (кадр K2), как проверяет сервис. */
export const SCREENSHOT = {
  maxBytes: 5 * 1024 * 1024,
  types: ["image/png", "image/jpeg"],
} as const;

/** Длина полей — как у сервиса: текст до 4 000 знаков, короткие поля до 300. */
export const FEEDBACK_LIMITS = { text: 4_000, short: 300 } as const;

/** Файл не подходит: не PNG и не JPEG, пустой или больше 5 МБ. */
export const screenshotProblem = (file: {
  type: string;
  size: number;
}): boolean =>
  !(SCREENSHOT.types as readonly string[]).includes(file.type) ||
  file.size === 0 ||
  file.size > SCREENSHOT.maxBytes;

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/YaBrowser\/(\d+)/, "Yandex Browser"],
  [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/Version\/(\d+(?:\.\d+)?).*Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

/**
 * Браузер с главной версией и система — «Chrome 131 · Windows»: кадр K2 обещает приложить версию
 * браузера. Всю строку агента не шлём — в ней лишнее.
 */
export function browserOf(ua: string): string {
  let browser = "Unknown browser";
  for (const [re, name] of BROWSERS) {
    const m = re.exec(ua);
    if (m !== null) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  return system === undefined ? browser : `${browser} · ${system}`;
}

/** Адрес страницы для отчёта: без служебных параметров аккаунта и якоря; длинный — без параметров. */
export function pageOf(href: string): string {
  const url = new URL(withoutAccountParams(href));
  url.hash = "";
  const full = url.toString();
  return full.length <= FEEDBACK_LIMITS.short
    ? full
    : `${url.origin}${url.pathname}`.slice(0, FEEDBACK_LIMITS.short);
}

/** Окно обратной связи открыто — одно на страницу; рюкзак, настройки и окно входа закрываются. */
export const feedbackPanelStore = createPanelStore();

export interface FeedbackRequest {
  kind: FeedbackKind;
  /** Кнопка, куда вернуть фокус: Safari не ставит фокус на кнопку по щелчку. */
  opener: HTMLElement | null;
  /** Новое открытие — новое число: поля окна начинаются заново. */
  serial: number;
}

let feedbackRequest: FeedbackRequest = {
  kind: "bug",
  opener: null,
  serial: 0,
};
const listeners = new Set<() => void>();

export const feedbackRequestStore = {
  get: (): FeedbackRequest => feedbackRequest,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useFeedbackRequest = (): FeedbackRequest =>
  useSyncExternalStore(
    feedbackRequestStore.subscribe,
    feedbackRequestStore.get,
    feedbackRequestStore.get,
  );

/** Открыть окно вида kind (пункт меню аккаунта). */
export function openFeedback(kind: FeedbackKind, opener?: HTMLElement): void {
  feedbackRequest = {
    kind,
    opener: opener ?? null,
    serial: feedbackRequest.serial + 1,
  };
  for (const listener of listeners) listener();
  menuStore.set(false);
  feedbackPanelStore.set(true, opener);
}

/** Отправка формы: поля строками, скриншот — файлом screenshot. */
export const feedbackApi = {
  send: (form: FormData): Promise<Reply> =>
    request("/api/account/feedback", { form }),
};

/** Поле, к которому относится ошибка сервиса; остальное — под формой. */
export type FeedbackField = "text" | "icons" | "feature" | "rating" | "file";

/** Код ответа сервиса → поле и текст (lib/i18n.ts). */
export function feedbackErrorOf(code: string): {
  field?: FeedbackField;
  message: MessageKey;
} {
  switch (code) {
    case "TEXT_REQUIRED":
      return { field: "text", message: "feedbackErrorText" };
    case "ICONS_REQUIRED":
      return { field: "icons", message: "feedbackErrorIcons" };
    case "FEATURE_REQUIRED":
      return { field: "feature", message: "feedbackErrorFeature" };
    case "RATING_REQUIRED":
      return { field: "rating", message: "feedbackErrorRating" };
    case "UNSUPPORTED_IMAGE":
    case "TOO_LARGE":
    case "SCREENSHOT_NOT_ALLOWED":
      return { field: "file", message: "feedbackErrorFile" };
    case "TOO_MANY_MESSAGES":
      return { message: "feedbackErrorTooMany" };
    case "SEND_FAILED":
    case "STORAGE_UNAVAILABLE":
      return { message: "feedbackErrorSend" };
    default:
      return { message: messageOf(code) };
  }
}
