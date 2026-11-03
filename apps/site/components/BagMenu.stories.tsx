import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Lang } from "../lib/i18n";
import { BagMenu } from "./BagMenu";

// Сумка в шапке (шаг 5 фазы 4): кнопка с числом иконок и немодальное меню. Содержимое — из localStorage
// браузера (iconavo-bag): иконки кладут кнопка «В сумку» в панели и режим «Выбрать несколько».
const meta = {
  title: "Site/BagMenu",
  component: BagMenu,
  args: { lang: "en" },
  render: (args, { globals }) => (
    <BagMenu {...args} lang={globals.lang as Lang} />
  ),
} satisfies Meta<typeof BagMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = { args: { defaultOpen: true } };
