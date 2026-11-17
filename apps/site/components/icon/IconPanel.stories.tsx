import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { PanelView } from "../../lib/panel-code";
import { panelViewStore } from "../../lib/prefs";
import { IconPanel } from "./IconPanel";

// Панель иконки по макету «Icon Panel» (Figma «Iconavo — Макеты»): колонка справа от сетки, на узком
// холсте — шторка снизу. Рисунок и сведения о наборе — с живых хостов. Вид кода запоминается в
// хранилище вкладки, поэтому каждая история ставит свой перед показом.
const meta = {
  title: "Icon/IconPanel",
  component: IconPanel,
  decorators: [
    (Story) => (
      <div className="page">
        <div className="with-panel" data-panel="">
          <div className="grid-area" />
          <Story />
        </div>
      </div>
    ),
  ],
  parameters: { nextjs: { navigation: { pathname: "/lucide" } } },
  args: { lang: "en", icon: "lucide:house", focus: 0, onClose: () => {} },
} satisfies Meta<typeof IconPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const view = (v: PanelView) => () => {
  panelViewStore.set(v);
};

export const ReactPackage: Story = { beforeEach: view("react") };

export const Svg: Story = { beforeEach: view("svg") };

export const CssUrl: Story = { beforeEach: view("css-url") };

export const Html: Story = { beforeEach: view("html") };

export const Russian: Story = {
  args: { lang: "ru", icon: "ph:house-bold" },
  beforeEach: view("react"),
};

/** Цветной набор: поля Color и толщины нет. */
export const Emoji: Story = {
  args: { icon: "fluent-emoji-flat:house" },
  beforeEach: view("react"),
};
