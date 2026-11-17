import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { Lang } from "../../lib/i18n";
import type { Style } from "../../lib/search";
import { LicenseChecks, SetChecks, StyleChoice } from "./SearchFilters";
import { STORY_GROUPS, STORY_LICENSES } from "./story-data";

// Фильтры выдачи во вкладках левой панели страницы поиска (решение владельца 17 ноября 2026): наборы —
// чекбоксами под «Search Results», как в макете, стиль — один выбор, лицензии — чекбоксы и пометка.
function Filters({ lang }: { lang: Lang }) {
  const [sets, setSets] = useState<string[]>(["ph"]);
  const [style, setStyle] = useState<Style>();
  const [licenses, setLicenses] = useState<string[]>([]);
  return (
    <div className="sidebar">
      <div className="sidebar-body">
        <div className="sidebar-sets sidebar-filters">
          <SetChecks
            lang={lang}
            groups={STORY_GROUPS}
            needle=""
            selected={sets}
            onChange={setSets}
            grouped={false}
            title="Search Results"
          />
          <StyleChoice
            lang={lang}
            name="story-style"
            value={style}
            onChange={setStyle}
          />
          <LicenseChecks
            lang={lang}
            licenses={STORY_LICENSES}
            selected={licenses}
            commercial={false}
            onChange={(next) => setLicenses(next.licenses)}
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Search/SearchFilters",
  component: Filters,
  args: { lang: "en" },
  render: (args, { globals }) => (
    <Filters {...args} lang={globals.lang as Lang} />
  ),
} satisfies Meta<typeof Filters>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sidebar: Story = {};
