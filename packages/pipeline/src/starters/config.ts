// Живые примеры (фаза 3, шаг 10; ADR-0050): папки examples/starters, их адреса, порты и пороги
// проверки. Примеры самостоятельные: в рабочее пространство pnpm они не входят и ставят пакеты из npm —
// так их открывает StackBlitz и так их копирует разработчик.

import { join } from "node:path";

export type StarterId = "html" | "react" | "next";

/** Примеры по порядку: HTML без сборщика, React на Vite, Next.js. */
export const STARTER_IDS: readonly StarterId[] = ["html", "react", "next"];

export const STARTER_TITLES: Record<StarterId, string> = {
  html: "HTML",
  react: "React (Vite)",
  next: "Next.js",
};

export const isStarterId = (value: string): value is StarterId =>
  (STARTER_IDS as readonly string[]).includes(value);

/** Папка примеров от корня репозитория. */
export const STARTERS_DIR = join("examples", "starters");

/** Рабочие копии примеров, архивы пакетов и установленные зависимости — не в git. */
export const WORK_DIR = join(".cache", "starters");

/** Пакеты, которые примеры ставят из npm; в проверке — архивы pnpm pack этой ветки. */
export const PACKAGES = ["core", "icon", "react"] as const;

export type PackageId = (typeof PACKAGES)[number];

/** Репозиторий и ветка: из них StackBlitz и create-next-app берут папки примеров. */
export const REPO = "iconavo/iconavo";
export const BRANCH = "main";

/** Скрипт тега у HTML-примера: в проверке — на столько позже, чтобы было видно, что место держит стиль. */
export const SCRIPT_DELAY_MS = 1000;

/** Иконки дорисовались за столько — иначе «не нарисованы». */
export const DRAW_TIMEOUT_MS = 60_000;

/** Установка, сборка и запуск примера на медленном компьютере. */
export const RUN_TIMEOUT_MS = 600_000;

/** Окно браузера в проверке. */
export const VIEWPORT = { width: 1000, height: 1200 };
