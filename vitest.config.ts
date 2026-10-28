// Настройки Vitest для всего репозитория. Тесты находятся сами (*.test.ts), здесь — только покрытие
// (ADR-0035): какую долю кода пакетов проверяют тесты. Считается с флагом --coverage — в CI и в
// pnpm check; обычный pnpm test идёт без него, быстрее.
// - Меряются ядро, тег и React — исходники, которые тесты запускают напрямую. Тесты и помощники тестов
//   (*.testing.ts) не считаются.
// - Порог — только у ядра, как в ADR-0035: не меньше 90% строк, веток и функций. Ниже — проверка
//   красная.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/{core,icon,react}/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.testing.ts", "**/*.d.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: ".cache/reports/coverage",
      thresholds: {
        "packages/core/src/**": {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
