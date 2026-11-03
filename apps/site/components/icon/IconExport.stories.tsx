import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { IconDetails } from "../../lib/icon";
import { IconExport } from "./IconExport";

// Скачивание (шаг 5 фазы 4): SVG с комментарием об авторе и лицензии и PNG нужного размера — его
// рисует браузер. Рисунок — с живых хостов.
const meta = {
  title: "Icon/IconExport",
  component: IconExport,
  decorators: [
    (Story) => (
      <div className="page icon-page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IconExport>;

export default meta;
type Story = StoryObj<typeof meta>;

const LUCIDE: IconDetails = {
  icon: "lucide:house",
  set: {
    prefix: "lucide",
    name: "Lucide",
    author: { name: "Lucide Contributors", url: "https://lucide.dev" },
    license: { title: "ISC", spdx: "ISC" },
    palette: false,
  },
  card: "lucide:house",
  style: "outline",
  variants: [{ style: "outline", icons: ["lucide:house"] }],
  tones: [],
  strokes: true,
  description: null,
  synonyms: null,
  tags: ["home"],
  similar: [],
};

export const Ready: Story = {
  args: {
    lang: "en",
    name: "lucide:house",
    details: LUCIDE,
    applies: { palette: false, strokes: true },
    H: "h2",
  },
};

export const WaitingForDetails: Story = {
  args: {
    lang: "ru",
    name: "lucide:house",
    details: undefined,
    applies: { palette: false, strokes: false },
    H: "h3",
  },
};
