import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BAG_KEY, bagPanelStore } from "../../lib/bag";
import type { Lang } from "../../lib/i18n";
import { BagButton } from "./BagButton";
import { BagPanel } from "./BagPanel";

// Рюкзак по макету (сценарий «Рюкзак»): кнопка Bag с числом и панель справа, на узком холсте — шторка.
// Содержимое — из localStorage браузера (iconavo-bag); каждая история кладёт своё и открывает панель.
const meta = {
  title: "Site/BagPanel",
  component: BagPanel,
  args: { lang: "en" },
  render: (args, { globals }) => (
    <>
      <BagButton lang={globals.lang as Lang} variant="pill" />
      <BagPanel {...args} lang={globals.lang as Lang} />
    </>
  ),
} satisfies Meta<typeof BagPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const fill = (names: string[]) => () => {
  try {
    localStorage.setItem(BAG_KEY, JSON.stringify(names));
  } catch {
    // Хранилище запрещено — история покажет пустой рюкзак.
  }
  bagPanelStore.set(true);
  return () => bagPanelStore.set(false);
};

export const Picked: Story = {
  beforeEach: fill([
    "lucide:a-arrow-up",
    "lucide:accessibility",
    "lucide:airplay",
    "lucide:activity",
    "tabler:home",
    "material-symbols:table-lamp",
  ]),
};

export const Empty: Story = { beforeEach: fill([]) };

/** Только эмодзи: цвета и толщины у них нет — полей нет. */
export const Emoji: Story = {
  beforeEach: fill(["fluent-emoji-flat:house", "fluent-emoji-flat:rocket"]),
};
