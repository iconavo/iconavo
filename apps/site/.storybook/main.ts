import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import { installFromReadme } from "../lib/install-readme";

// Витрина компонентов сайта (ADR-0038, решение владельца 30 октября 2026): только для разработки,
// pnpm storybook → http://127.0.0.1:6006. Истории лежат рядом с компонентами. Телеметрию Storybook не
// отправляет; описания пропсов из типов выключены — у TypeScript 7 нет программного API.
// Строки установки генератора кода — из README тега, как в next.config.ts (шаг 5 фазы 4, ADR-0042).
const install = installFromReadme(
  readFileSync(
    join(process.cwd(), "..", "..", "packages", "icon", "README.md"),
    "utf8",
  ),
);

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
  viteFinal: (vite) => ({
    ...vite,
    define: {
      ...vite.define,
      "process.env.ICONAVO_INSTALL": JSON.stringify(JSON.stringify(install)),
    },
  }),
};

export default config;
