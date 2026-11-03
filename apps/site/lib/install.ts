// Установка пакетов для генератора кода (шаг 5 фазы 4, ADR-0042): имена пакетов, строки подключения и
// строки для страниц без сборщика — из README тега, как документация (ADR-0050). Их вшивает в код
// next.config.ts при сборке (переменная ICONAVO_INSTALL, разбор — install-readme.ts): страницы иконок
// собираются по первому запросу на Vercel, а README в функции нет. Команды — npm, pnpm и yarn, без
// тега @next: latest идёт за каждой бетой (ADR-0051).

export interface Install {
  /** Страницы без сборщика: строки <script> с хэшем integrity и <style> — как в README. */
  script: string;
  tag: { package: string; import: string };
  react: { package: string; import: string };
}

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** Команда установки пакета. */
export const installCommand = (pm: PackageManager, pkg: string): string =>
  pm === "npm" ? `npm install ${pkg}` : `${pm} add ${pkg}`;

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
