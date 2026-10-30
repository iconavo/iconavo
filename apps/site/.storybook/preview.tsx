import { type IconavoIconSet, IconavoProvider } from "@iconavo-ui/react";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { loadSiteIcons } from "../lib/icons";
import "../app/globals.css";

// Иконки сайта — те же, что на страницах: грузятся с живых хостов один раз и попадают в истории через
// IconavoProvider. Нет сети — истории без иконок, а не ошибка.
const withIcons: Decorator = (Story, { loaded }) => (
  <IconavoProvider icons={(loaded.icons as IconavoIconSet[]) ?? []}>
    <Story />
  </IconavoProvider>
);

const preview: Preview = {
  parameters: {
    nextjs: { appDirectory: true },
    layout: "padded",
  },
  globalTypes: {
    lang: {
      description: "Язык интерфейса",
      toolbar: {
        title: "Язык",
        icon: "globe",
        items: [
          { value: "en", title: "English" },
          { value: "ru", title: "Русский" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { lang: "en" },
  loaders: [async () => ({ icons: await loadSiteIcons().catch(() => []) })],
  decorators: [
    withIcons,
    // Тема — атрибутом data-theme у <html>, как ставит её сайт (lib/theme.ts).
    withThemeByDataAttribute({
      themes: { light: "light", dark: "dark" },
      defaultTheme: "light",
      attributeName: "data-theme",
    }),
  ],
};

export default preview;
