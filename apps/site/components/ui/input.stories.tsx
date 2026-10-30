import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  args: { placeholder: "Search icons", "aria-label": "Search icons" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = { args: { defaultValue: "house" } };

export const Disabled: Story = { args: { disabled: true } };
