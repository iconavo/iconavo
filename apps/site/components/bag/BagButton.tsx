"use client";

import { Icon } from "@iconavo-ui/react";
import { bagPanelStore, useBag, useBagPanel } from "../../lib/bag";
import { cn } from "../../lib/cn";
import { countOf, ICON_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { BAG_PANEL_ID } from "./BagPanel";

/**
 * Кнопка рюкзака (макет: Bag в шапке, Bag Count): открывает и закрывает панель рюкзака. Число — лаймовая
 * таблетка справа от слова, у квадратной кнопки (телефон, подвал) — кружок в углу; появляется после
 * гидратации, шапка не сдвигается.
 */
export function BagButton({
  lang,
  variant,
}: {
  lang: Lang;
  /** «pill» — значок и слово Bag в верхней полосе, «icon» — квадратная кнопка подвала. */
  variant: "pill" | "icon";
}) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const open = useBagPanel();
  return (
    <button
      type="button"
      className={cn("bag-button", variant === "pill" ? "pill" : "bag-square")}
      aria-expanded={open}
      aria-controls={BAG_PANEL_ID}
      aria-label={
        bag.length === 0
          ? t.bag
          : t.bagLabel.replace(
              "{count}",
              countOf(lang, bag.length, ICON_FORMS[lang]),
            )
      }
      onClick={(e) => bagPanelStore.set(!open, e.currentTarget)}
    >
      <Icon icon="material-symbols:backpack" className="pill-chevron" />
      {variant === "pill" ? (
        <span className="pill-label" aria-hidden="true">
          {t.bag}
        </span>
      ) : null}
      {bag.length > 0 ? (
        <span className="bag-count" aria-hidden="true">
          {bag.length}
        </span>
      ) : null}
    </button>
  );
}
