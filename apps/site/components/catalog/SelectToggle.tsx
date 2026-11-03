"use client";

import { useState } from "react";
import { bagStore, useBag } from "../../lib/bag";
import { countOf, ICON_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { buttonClass } from "../ui/button";

/** Режим «Выбрать несколько» сетки: включён ли, что в сумке, положить или убрать иконку. */
export interface Select {
  on: boolean;
  setOn: (on: boolean) => void;
  bag: readonly string[];
  /** Сумка полна — последняя иконка не легла. */
  full: boolean;
  pick: (name: string) => void;
}

export function useSelect(): Select {
  const [on, setOn] = useState(false);
  const [full, setFull] = useState(false);
  const bag = useBag();
  return {
    on,
    setOn: (next) => {
      setOn(next);
      setFull(false);
    },
    bag,
    full,
    pick: (name) => setFull(bagStore.toggle(name) === "full"),
  };
}

/**
 * Переключатель «Выбрать несколько» над сеткой набора и выдачей поиска (шаг 5 фазы 4, решение владельца
 * 3 ноября 2026): пока он включён, щелчок по иконке кладёт её в сумку или убирает, панель не
 * открывается. Строка состояния объявляет, сколько иконок в сумке. Режим не попадает в адрес.
 */
export function SelectToggle({ lang, select }: { lang: Lang; select: Select }) {
  const t = DICTIONARIES[lang];
  return (
    <p className="select-bar">
      <button
        type="button"
        className={buttonClass(select.on ? "primary" : "outline")}
        aria-pressed={select.on}
        onClick={() => select.setOn(!select.on)}
      >
        {t.bagSelect}
      </button>
      <span className="select-status" role="status">
        {select.full
          ? t.bagFull
          : select.on
            ? t.bagSelected.replace(
                "{count}",
                countOf(lang, select.bag.length, ICON_FORMS[lang]),
              )
            : ""}
      </span>
    </p>
  );
}
