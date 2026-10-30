import type { StorybookConfig } from "@storybook/nextjs-vite";

// Витрина компонентов сайта (ADR-0038, решение владельца 30 октября 2026): только для разработки,
// pnpm storybook → http://127.0.0.1:6006. Истории лежат рядом с компонентами. Телеметрию Storybook не
// отправляет; описания пропсов из типов выключены — у TypeScript 7 нет программного API.
const config: StorybookConfig = {
  stories: ["../components/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
};

export default config;
