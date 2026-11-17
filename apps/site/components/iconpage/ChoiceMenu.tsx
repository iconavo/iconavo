"use client";

import { Icon } from "@iconavo-ui/react";
import { DropdownMenu as Primitive } from "radix-ui";
import {
  Fragment,
  type ReactElement,
  type RefObject,
  useId,
  useRef,
  useState,
} from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { DropdownMenu, DropdownMenuTrigger } from "../ui/dropdown-menu";

/** Пункт меню: подпись, отмечен ли галочкой, отделён ли чертой сверху. */
export interface ChoiceItem {
  id: string;
  label: string;
  checked?: boolean;
  separated?: boolean;
}

/** Телефон — как раскладка сайта (до 64rem): вместо выпадающего меню — шторка снизу. */
const PHONE = "(max-width: 63.98rem)";

/**
 * Меню выбора страницы иконки по макету (Copy Menu, «Bottom Sheet — Copy as»): на компьютере —
 * выпадающее меню Radix, всегда немодальное (ADR-0038), на телефоне — шторка снизу: родной <dialog>,
 * строки по 44 px, ✕ и затемнение закрывают; фокус — на самой шторке, дальше Tab. Выбор срабатывает прямо
 * в щелчке — буфер обмена Safari пускает запись только во время него (lib/clipboard.ts). anchor — элемент,
 * от левого края которого открывается меню (у Copy SVG ▾ — вся кнопка, а не стрелка).
 */
export function ChoiceMenu({
  lang,
  title,
  titleIcon,
  items,
  onChoose,
  anchor,
  children,
}: {
  lang: Lang;
  /** Заголовок шторки и подпись меню для скринридера. */
  title: string;
  titleIcon: string;
  items: ChoiceItem[];
  onChoose: (id: string) => void;
  anchor?: RefObject<HTMLElement | null>;
  /** Кнопка, которая открывает меню. */
  children: ReactElement;
}) {
  const t = DICTIONARIES[lang];
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const choose = (id: string) => {
    sheet.current?.close();
    onChoose(id);
  };
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next && window.matchMedia(PHONE).matches) {
            sheet.current?.showModal();
            body.current?.focus();
            return;
          }
          if (next && anchor?.current && trigger.current) {
            setOffset(
              anchor.current.getBoundingClientRect().left -
                trigger.current.getBoundingClientRect().left,
            );
          }
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild ref={trigger}>
          {children}
        </DropdownMenuTrigger>
        <Primitive.Portal>
          <Primitive.Content
            align="start"
            alignOffset={offset}
            sideOffset={8}
            className="ip-menu"
            aria-label={title}
          >
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.separated ? (
                  <Primitive.Separator className="ip-menu-separator" />
                ) : null}
                <Primitive.Item
                  className="ip-menu-item"
                  onSelect={() => onChoose(item.id)}
                >
                  <span>{item.label}</span>
                  {item.checked ? (
                    <Icon
                      icon="material-symbols:check"
                      className="ip-menu-check"
                      label={t.ipSelected}
                    />
                  ) : null}
                </Primitive.Item>
              </Fragment>
            ))}
          </Primitive.Content>
        </Primitive.Portal>
      </DropdownMenu>
      {/* Щелчок мимо шторки попадает в сам <dialog> (его ::backdrop) — закрыть. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры шторку закрывают Esc и кнопка ✕ */}
      <dialog
        ref={sheet}
        className="ip-sheet"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div ref={body} className="ip-sheet-body" tabIndex={-1}>
          <span className="ip-sheet-handle" aria-hidden="true" />
          <div className="ip-sheet-head">
            <Icon icon={titleIcon} className="ip-sheet-icon" />
            <span id={titleId} className="ip-sheet-title">
              {title}
            </span>
            <button
              type="button"
              className="ip-sheet-close"
              aria-label={t.panelClose}
              onClick={() => sheet.current?.close()}
            >
              <Icon icon="material-symbols:close" />
            </button>
          </div>
          <ul className="ip-sheet-list">
            {items.map((item) => (
              <li
                key={item.id}
                className={item.separated ? "ip-sheet-separated" : undefined}
              >
                <button
                  type="button"
                  className="ip-sheet-item"
                  onClick={() => choose(item.id)}
                >
                  <span>{item.label}</span>
                  {item.checked ? (
                    <Icon
                      icon="material-symbols:check"
                      className="ip-menu-check"
                      label={t.ipSelected}
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
