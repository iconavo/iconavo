import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Header } from "./Header";

const meta = {
  title: "Site/Header",
  component: Header,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const English: Story = {
  args: { lang: "en" },
  parameters: { nextjs: { navigation: { pathname: "/" } } },
};

export const Russian: Story = {
  args: { lang: "ru" },
  parameters: { nextjs: { navigation: { pathname: "/ru" } } },
};

export const NotFoundPage: Story = {
  args: { lang: "en", languageSwitch: false },
  parameters: { nextjs: { navigation: { pathname: "/__missing__" } } },
};
