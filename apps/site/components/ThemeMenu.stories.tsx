import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Lang } from "../lib/i18n";
import type { Theme, ThemeStore } from "../lib/theme";
import { ThemeMenu } from "./ThemeMenu";

// В витрине тему страницы ставит аддон тем: меню получает своё хранилище в памяти и не трогает
// ни localStorage, ни атрибут <html>.
function memoryStore(): ThemeStore {
  let theme: Theme = "system";
  const listeners = new Set<() => void>();
  return {
    get: () => theme,
    set(next) {
      theme = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const store = memoryStore();

const meta = {
  title: "Site/ThemeMenu",
  component: ThemeMenu,
  args: { lang: "en" },
  render: (args, { globals }) => (
    <ThemeMenu {...args} lang={globals.lang as Lang} store={store} />
  ),
} satisfies Meta<typeof ThemeMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = { args: { defaultOpen: true } };
