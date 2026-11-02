"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useRef, useState } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { bareName } from "../../lib/icon";
import { Button } from "../ui/button";
import { IconDetails } from "./IconDetails";
import { useIconDetails } from "./useIconDetails";

/** Поле ввода вне панели: там Esc остаётся своим — в поле поиска он очищает текст. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement &&
      !["checkbox", "radio", "range", "color", "button"].includes(target.type))
  );
}

/**
 * Боковая панель иконки (шаг 4 фазы 4; решение владельца 2 ноября 2026). Немодальная: выдачу и сетку
 * рядом можно листать и щёлкать — панель покажет выбранную иконку. На компьютере — колонка справа от
 * сетки, на телефоне — шторка снизу, её можно развернуть во весь экран. Это <aside>, а не диалог;
 * модальных компонентов Radix нет — они вставляют <style>, а CSP сайта его не пускает (ADR-0038).
 * - Первое открытие — фокус на заголовок; смена иконки щелчком в сетке фокус не трогает, новое имя
 *   объявляет строка состояния.
 * - ✕ и Esc закрывают; Esc в полях ввода вне панели остаётся их.
 */
export function IconPanel({
  lang,
  icon,
  focus,
  onClose,
  onPick,
}: {
  lang: Lang;
  icon: string;
  /** Номер открытия: меняется — фокус на заголовок. */
  focus: number;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  const t = DICTIONARIES[lang];
  const { details, state, retry } = useIconDetails(icon);
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focus > 0) heading.current?.focus();
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const inside = panel.current?.contains(e.target as Node) ?? false;
      if (!inside && typing(e.target)) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = details?.icon ?? icon;
  return (
    <aside
      ref={panel}
      className="icon-panel"
      aria-labelledby="icon-panel-title"
      data-expanded={expanded ? "" : undefined}
      data-panel-icon={shown}
    >
      <div className="icon-panel-head">
        <h2 id="icon-panel-title" ref={heading} tabIndex={-1}>
          {bareName(shown)}
          <span className="icon-panel-set">
            {details?.set.name ?? shown.slice(0, shown.indexOf(":"))}
          </span>
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="icon-panel-expand"
          aria-expanded={expanded}
          aria-label={expanded ? t.panelCollapse : t.panelExpand}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon
            icon={expanded ? "lucide:minimize-2" : "lucide:maximize-2"}
            className="inline-block"
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.panelClose}
          onClick={onClose}
        >
          <Icon icon="lucide:x" className="inline-block" />
        </Button>
      </div>
      <p className="sr-only" role="status">
        {shown}
      </p>
      <IconDetails
        lang={lang}
        icon={icon}
        details={details}
        state={state}
        onRetry={retry}
        mode="panel"
        onPick={onPick}
      />
    </aside>
  );
}
