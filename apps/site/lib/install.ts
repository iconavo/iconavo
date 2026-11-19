// Установка пакетов для генератора кода (шаг 5 фазы 4, ADR-0042): типы и команды — в общем модуле
// packages/snippets (шаг 10 фазы 4, ADR-0044). Строки README вшивает в код next.config.ts при сборке
// (переменная ICONAVO_INSTALL): страницы иконок собираются по первому запросу на Vercel, а README в
// функции нет.

import type { Install } from "@iconavo-ui/snippets/install";

export * from "@iconavo-ui/snippets/install";

/** Строки README этой сборки; Next.js и Storybook подставляют их вместо process.env.ICONAVO_INSTALL. */
export function builtInstall(): Install {
  const text = process.env.ICONAVO_INSTALL;
  if (text === undefined || text === "") {
    throw new Error(
      "ICONAVO_INSTALL не задан: строки README тега вшивает next.config.ts",
    );
  }
  return JSON.parse(text) as Install;
}
