import { Icon } from "@iconavo-ui/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Button" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary" } };

export const Outline: Story = { args: { variant: "outline" } };

export const Ghost: Story = { args: { variant: "ghost" } };

export const IconOnly: Story = {
  args: {
    variant: "ghost",
    size: "icon",
    "aria-label": "Search",
    children: <Icon icon="lucide:search" />,
  },
};

export const Disabled: Story = { args: { disabled: true } };
