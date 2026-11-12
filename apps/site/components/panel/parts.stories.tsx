import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CodeBlock, Pill, PillGroup } from "./parts";

// Детали панели иконки по макету «Icon Panel» (Figma «Iconavo — Макеты», раздел 02 · Parts).
const meta = {
  title: "Panel/CodeBlock",
  component: CodeBlock,
  decorators: [
    (Story) => (
      <div className="page icon-panel">
        <div className="panel-section panel-code-section">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Install: Story = {
  args: { lang: "en", label: "Install", code: "npm install @iconavo-ui/react" },
};

export const Limited: Story = {
  args: {
    lang: "en",
    label: "SVG",
    limited: true,
    download: { name: "lucide-house.svg", type: "image/svg+xml" },
    code: Array.from({ length: 16 }, (_, i) => `<path d="M${i} 0h24" />`).join(
      "\n",
    ),
  },
};

export const Pills: StoryObj<typeof Pill> = {
  render: () => (
    <PillGroup label="Components">
      <Pill lang="en">HTML</Pill>
      <Pill lang="en" selected>
        React
      </Pill>
      <Pill lang="en" soon>
        Vue
      </Pill>
    </PillGroup>
  ),
};
