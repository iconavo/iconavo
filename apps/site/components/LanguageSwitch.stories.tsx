import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LanguageSwitch } from "./LanguageSwitch";

// Адрес страницы подставляет Storybook: ссылка ведёт на ту же страницу на другом языке.
const at = (pathname: string) => ({
  nextjs: { navigation: { pathname } },
});

const meta = {
  title: "Site/LanguageSwitch",
  component: LanguageSwitch,
} satisfies Meta<typeof LanguageSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnEnglishPage: Story = { parameters: at("/search") };

export const OnRussianPage: Story = { parameters: at("/ru/search") };

export const OnDocsPage: Story = { parameters: at("/docs/reference") };
