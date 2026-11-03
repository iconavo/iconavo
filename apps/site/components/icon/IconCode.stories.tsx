import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconCode } from "./IconCode";

// Генератор кода (шаг 5 фазы 4): вид кода и менеджер пакетов переключаются кнопками и запоминаются;
// настройки — общие с панелью. Строки установки — из README тега (.storybook/main.ts).
const meta = {
  title: "Icon/IconCode",
  component: IconCode,
  decorators: [
    (Story) => (
      <div className="page icon-page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IconCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LineIcon: Story = {
  args: {
    lang: "en",
    name: "lucide:house",
    applies: { palette: false, strokes: true },
    H: "h2",
  },
};

export const MulticolorRussian: Story = {
  args: {
    lang: "ru",
    name: "fluent-emoji-flat:waving-hand",
    applies: { palette: true, strokes: false },
    H: "h3",
  },
};
