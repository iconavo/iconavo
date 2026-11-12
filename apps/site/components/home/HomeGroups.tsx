"use client";

import { Icon } from "@iconavo-ui/react";
import { type ReactNode, useState } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";

/**
 * Группы наборов главной с чипсами по макету телефона («Icon Sets / Mobile»): All и по группе. Выбор
 * прячет другие группы правилом CSS по data-filter (globals.css), без запросов. Группы — серверная
 * разметка (children), здесь только переключатель.
 */
export function HomeGroups({
  lang,
  groups,
  children,
}: {
  lang: Lang;
  groups: { id: string; label: string }[];
  children: ReactNode;
}) {
  const t = DICTIONARIES[lang];
  const [filter, setFilter] = useState("all");
  const chips = [{ id: "all", label: t.groupAll }, ...groups];
  return (
    <div className="home-groups" data-filter={filter}>
      <fieldset className="group-chips">
        <legend className="sr-only">{t.sidebarLabel}</legend>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="group-chip"
            aria-pressed={filter === chip.id}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </fieldset>
      {children}
    </div>
  );
}

/**
 * «See all» у группы на телефоне: карточки группы идут в ряд с прокруткой, кнопка раскрывает их сеткой.
 * На компьютере сетка видна сразу, кнопки нет (CSS).
 */
export function SeeAll({ lang, group }: { lang: Lang; group: string }) {
  const t = DICTIONARIES[lang];
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="group-see-all"
      aria-expanded={open}
      aria-controls={`group-grid-${group}`}
      onClick={() => {
        setOpen(!open);
        document
          .getElementById(`group-grid-${group}`)
          ?.toggleAttribute("data-expanded", !open);
      }}
    >
      {open ? t.groupShowLess : t.groupSeeAll}
      <Icon
        icon={open ? "lucide:chevron-down" : "lucide:chevron-right"}
        className="pill-chevron"
      />
    </button>
  );
}
