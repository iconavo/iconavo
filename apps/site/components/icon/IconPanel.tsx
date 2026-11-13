"use client";

import { hasStrokeWidth } from "@iconavo-ui/core/internal";
import { Icon } from "@iconavo-ui/react";
import { useEffect, useRef, useState } from "react";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { bareName, type IconSetSummary, iconPagePath } from "../../lib/icon";
import { iconProps, useIconSettings } from "../../lib/icon-settings";
import { panelSettings } from "../../lib/panel-code";
import { fitPanel } from "../../lib/panel-fit";
import { PanelActions } from "../panel/actions";
import {
  PanelColor,
  PanelName,
  PanelSize,
  PanelStroke,
} from "../panel/controls";
import { PanelCode } from "../panel/PanelCode";
import { PanelCredits } from "../panel/PanelCredits";
import { useSetInfo } from "../panel/useSetInfo";
import { useIconData } from "./useIconData";
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

/** Протяжка ручки шторки дальше этого — жест, ближе — нажатие. */
const DRAG = 24;

/**
 * Панель иконки по макету «Icon Panel» (Figma «Iconavo — Макеты», 355 px; решения владельца 12 ноября
 * 2026): имя и набор, превью на светлом и тёмном фоне, Size и Color, Copy Icon, Download и сумка, Name и
 * Stroke Width, блок кода, внизу — автор и лицензия. Немодальная: сетку рядом можно листать и щёлкать.
 * На компьютере — колонка справа от сетки; на телефоне — шторка снизу (560 px из 844, как в макете): ручка
 * раскрывает её почти на весь экран, протяжка вниз сворачивает и закрывает, тап по затемнению — закрывает.
 * - Первое открытие — фокус на заголовок; смена иконки щелчком в сетке фокус не трогает, новое имя
 *   объявляет строка состояния.
 * - ✕ и Esc закрывают; Esc в полях ввода вне панели остаётся их.
 * Данные: рисунок — ядро пакета, набор — каталог наборов; адрес /icon (поиск) нужен только для строки про
 * части набора от других авторов (Feather у Lucide) — без него раздел авторства всё равно есть.
 */
export function IconPanel({
  lang,
  icon,
  focus,
  onClose,
}: {
  lang: Lang;
  icon: string;
  /** Номер открытия: меняется — фокус на заголовок. */
  focus: number;
  onClose: () => void;
  /** Переход к другой иконке из панели; в панели по макету таких ссылок нет. */
  onPick?: (name: string) => void;
}) {
  const t = DICTIONARIES[lang];
  const prefix = icon.slice(0, icon.indexOf(":"));
  const s = useIconSettings();
  const data = useIconData(icon, true);
  const info = useSetInfo(prefix);
  const { details, state } = useIconDetails(icon);
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Где нажали на ручку; после протяжки щелчок, который браузер пришлёт следом, — не в счёт. */
  const drag = useRef<number | undefined>(undefined);
  const dragged = useRef(false);

  useEffect(() => {
    if (focus > 0) heading.current?.focus();
  }, [focus]);

  // На компьютере панель всегда помещается в видимую часть окна (lib/panel-fit.ts).
  useEffect(() => {
    const element = panel.current;
    return element === null ? undefined : fitPanel(element);
  }, []);

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

  const palette = info?.palette ?? false;
  const strokes = data ? hasStrokeWidth(data.body) : false;
  const applies = { palette, strokes };
  const set: IconSetSummary | undefined =
    info === undefined
      ? undefined
      : {
          prefix,
          name: info.name,
          author: info.author,
          license: info.license,
          palette,
          ...(state === "ready" && details?.set.credits !== undefined
            ? { credits: details.set.credits }
            : {}),
        };
  const preview = {
    ...iconProps(panelSettings(s), { palette, strokes }),
    className: "panel-preview-svg",
  };

  return (
    <>
      <div className="panel-backdrop" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panel}
        className="icon-panel"
        aria-labelledby="icon-panel-title"
        data-expanded={expanded ? "" : undefined}
        data-panel-icon={icon}
      >
        <button
          type="button"
          className="panel-handle"
          aria-label={t.pHandle}
          aria-expanded={expanded}
          onPointerDown={(e) => {
            // Захват: мышь, уведённая с ручки, всё равно отпускается на ней.
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = e.clientY;
            dragged.current = false;
          }}
          onPointerUp={(e) => {
            const from = drag.current;
            drag.current = undefined;
            if (from === undefined) return;
            const dy = e.clientY - from;
            if (Math.abs(dy) <= DRAG) return;
            dragged.current = true;
            if (dy < 0) setExpanded(true);
            else if (expanded) setExpanded(false);
            else onClose();
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onClick={() => {
            // Нажатие без протяжки и с клавиатуры — раскрыть или свернуть.
            if (dragged.current) dragged.current = false;
            else setExpanded((v) => !v);
          }}
        />
        <div className="panel-top">
          <div className="panel-head">
            <h2 id="icon-panel-title" ref={heading} tabIndex={-1}>
              <span className="panel-title">{bareName(icon)}</span>
              <span className="panel-set">{info?.name ?? prefix}</span>
            </h2>
            <div className="panel-head-actions">
              <a
                href={href(lang, iconPagePath(icon))}
                className="panel-head-button"
                aria-label={t.panelOpenPage}
                target="_blank"
                rel="noopener"
              >
                <Icon icon="material-symbols:open-in-new" />
              </a>
              <button
                type="button"
                className="panel-head-button"
                aria-label={t.panelClose}
                onClick={onClose}
              >
                <Icon icon="material-symbols:close" />
              </button>
            </div>
          </div>
          <div className="panel-previews">
            <div className="panel-preview preview-light">
              <Icon icon={icon} {...preview} />
            </div>
            <div className="panel-preview preview-dark">
              <Icon icon={icon} {...preview} />
            </div>
          </div>
          <div className="panel-pair">
            <PanelSize lang={lang} s={s} />
            {palette ? null : <PanelColor lang={lang} s={s} />}
          </div>
          <PanelActions
            lang={lang}
            name={icon}
            s={s}
            applies={applies}
            set={set}
          />
        </div>
        <div className="panel-section panel-name-section">
          <PanelName lang={lang} name={icon} />
          {strokes ? <PanelStroke lang={lang} s={s} /> : null}
        </div>
        <div className="panel-section panel-code-section">
          <PanelCode
            lang={lang}
            name={icon}
            icon={data}
            s={s}
            applies={applies}
          />
        </div>
        <PanelCredits lang={lang} name={icon} set={set} />
        <p className="sr-only" role="status">
          {icon}
        </p>
      </aside>
    </>
  );
}
