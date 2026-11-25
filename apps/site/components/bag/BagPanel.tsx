"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { track } from "../../lib/analytics";
import {
  bagPanelStore,
  bagStore,
  missingMessage,
  useBag,
  useBagPanel,
} from "../../lib/bag";
import { type BagLook, SPRITE_NAME, ZIP_NAME } from "../../lib/bag-files";
import { saveFile } from "../../lib/download";
import { countOf, ICON_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  useCloseOnEscape,
  useCloseOnOutsideClick,
  useSidePanel,
} from "../../lib/panel-store";
// Хосты иконок — для ядра браузера: иконки рюкзака рисует оно (lib/iconavo.ts).
import "../../lib/iconavo";
import { ColorField, StrokeField } from "../panel/controls";

/** id панели — для aria-controls кнопок Bag. */
export const BAG_PANEL_ID = "bag-panel";

/** Протяжка ручки шторки вниз дальше этого — закрыть. */
const DRAG = 24;

/**
 * Рюкзак по макету (сценарий «Рюкзак», кадры Backpack и Backpack-Empty; решения владельца 13 ноября 2026):
 * на компьютере — панель справа во всю высоту поверх страницы, немодальная: сетку рядом можно листать и
 * класть иконки дальше; на телефоне — шторка почти на весь экран с затемнением. Внутри — «N icons
 * picked», список с ✕, внизу Color, Stroke Width, «Download SVG without fill color» (галочка — цвет
 * не вшивается в файлы, остаётся currentColor), Download ZIP и Download SVG Sprite. Clear — справа в строке
 * счётчика (в макете её нет; решение владельца 13 ноября 2026): рюкзак пустеет сразу, а пока панель
 * открыта, на месте списка — «Backpack cleared · Undo». Закрывают ✕, Esc, кнопка Bag и щелчок мимо панели
 * (решение владельца 23 ноября 2026); на телефоне ещё протяжка ручки вниз и тап по затемнению. Фокус — на заголовок при открытии и обратно на кнопку при
 * закрытии.
 */
export function BagPanel({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const open = useBagPanel();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<number | undefined>(undefined);
  const dragged = useRef(false);
  const [color, setColor] = useState<string>();
  const [stroke, setStroke] = useState<number>();
  const [withoutFill, setWithoutFill] = useState(false);
  const [applies, setApplies] = useState({ color: false, stroke: false });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Не вошли в последний скачанный файл (ревизия фазы 5, С-11); nothing — файла нет совсем.
  const [missing, setMissing] = useState<{
    names: string[];
    nothing: boolean;
  }>();
  // Очищенный рюкзак — для «Undo»: предложение живёт, пока панель открыта и рюкзак пуст.
  const [cleared, setCleared] = useState<readonly string[]>();
  const clearedId = useId();
  const clearButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  // Открыть и закрыть (lib/panel-store.ts): на компьютере — немодально, на телефоне — модально, с
  // затемнением; закрытие — с анимацией.
  useSidePanel(open, dialog, heading, bagPanelStore, BAG_PANEL_ID);

  // Щелчок мимо панели закрывает её (решение владельца 23 ноября 2026, lib/panel-store.ts): «в рюкзак» у
  // карточки при открытой панели кладёт иконку и закрывает панель.
  useCloseOnOutsideClick(open, dialog, bagPanelStore, BAG_PANEL_ID);

  // Esc закрывает панель первой — раньше панели иконки; открытое меню — ещё раньше (lib/panel-store.ts).
  useCloseOnEscape(open, bagPanelStore);

  useEffect(() => {
    if (!open || bag.length > 0) setCleared(undefined);
  }, [open, bag.length]);

  // Кнопки, на которой был фокус, после Clear и Undo больше нет: фокус — на «Undo», после возврата —
  // снова на Clear. flushSync — чтобы новая кнопка была на странице до фокуса.
  function clear() {
    const previous = bag;
    flushSync(() => {
      setCleared(previous);
      bagStore.clear();
    });
    undoButton.current?.focus();
  }

  function undo() {
    if (cleared === undefined) return;
    const previous = cleared;
    flushSync(() => bagStore.restore(previous));
    clearButton.current?.focus();
  }

  // Что применимо к иконкам рюкзака: у цветных наборов нет цвета, толщина — только у линий.
  useEffect(() => {
    if (!open || bag.length === 0) return;
    let live = true;
    import("../../lib/bag-export")
      .then((m) => m.bagIcons(bag).then(({ icons }) => m.bagApplies(icons)))
      .then(
        (a) => {
          if (live) setApplies(a);
        },
        () => {},
      );
    return () => {
      live = false;
    };
  }, [open, bag]);

  const note =
    missing === undefined
      ? undefined
      : missingMessage(t, missing.names, missing.nothing);

  const look: BagLook = {
    ...(applies.color && color !== undefined && !withoutFill ? { color } : {}),
    ...(applies.stroke && stroke !== undefined ? { stroke } : {}),
  };

  // Пока файл готовится, строки не отключаются — иначе браузер снял бы с нажатой фокус; повторный щелчок
  // просто не срабатывает (aria-disabled).
  // Не загрузившиеся иконки в файл не входят, и сайт их называет; не загрузилось ничего — файла нет (С-11).
  // В аналитике — сколько иконок в файле, а не в рюкзаке (С-29).
  async function download(kind: "zip" | "sprite") {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMissing(undefined);
    try {
      const m = await import("../../lib/bag-export");
      let made: { count: number; missing: string[] };
      if (kind === "zip") {
        const zip = await m.bagZip(bag, look);
        if (zip.file !== undefined) {
          saveFile(ZIP_NAME, zip.file, "application/zip");
        }
        made = zip;
      } else {
        const sprite = await m.bagSprite(bag, look);
        if (sprite.file !== undefined) {
          saveFile(SPRITE_NAME, sprite.file, "image/svg+xml");
        }
        made = sprite;
      }
      setMissing({ names: made.missing, nothing: made.count === 0 });
      if (made.count > 0) {
        track({ name: "download", format: kind, count: made.count });
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Щелчок мимо шторки попадает в сам <dialog> (его ::backdrop) — закрыть. С клавиатуры — Esc и ✕.
    // biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры панель закрывают Esc и кнопка ✕
    <dialog
      ref={dialog}
      id={BAG_PANEL_ID}
      className="bag-panel"
      aria-labelledby={titleId}
      data-empty={bag.length === 0 ? "" : undefined}
      onCancel={(e) => {
        e.preventDefault();
        bagPanelStore.set(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) bagPanelStore.set(false);
      }}
    >
      <div className="bag-panel-body">
        <button
          type="button"
          className="bag-grabber"
          aria-label={t.panelClose}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = e.clientY;
            dragged.current = false;
          }}
          onPointerUp={(e) => {
            const from = drag.current;
            drag.current = undefined;
            if (from === undefined) return;
            const dy = e.clientY - from;
            // Протяжка, а не нажатие: щелчок, который браузер пришлёт следом, не закрывает шторку —
            // закрывает только протяжка вниз (ревизия фазы 5, С-30).
            if (Math.abs(dy) > DRAG) dragged.current = true;
            if (dy > DRAG) bagPanelStore.set(false);
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onClick={() => {
            if (dragged.current) dragged.current = false;
            else bagPanelStore.set(false);
          }}
        >
          <span className="bag-grabber-bar" />
        </button>
        <div className="bag-panel-head">
          <h2
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="bag-panel-title"
          >
            <Icon
              icon="material-symbols:backpack"
              className="bag-panel-title-icon"
            />
            {t.bagTitle}
          </h2>
          <button
            type="button"
            className="bag-panel-close"
            aria-label={t.panelClose}
            onClick={() => bagPanelStore.set(false)}
          >
            <Icon icon="material-symbols:close" />
          </button>
        </div>
        {bag.length === 0 ? (
          <div className="bag-empty">
            <Icon icon="material-symbols:toc" className="bag-empty-icon" />
            {cleared === undefined ? (
              <p className="bag-empty-text">{t.bagEmpty}</p>
            ) : (
              <p className="bag-empty-text">
                <span id={clearedId}>{t.bagCleared}</span>
                <span aria-hidden="true"> · </span>
                <button
                  ref={undoButton}
                  type="button"
                  className="bag-undo"
                  aria-describedby={clearedId}
                  onClick={undo}
                >
                  {t.bagUndo}
                </button>
              </p>
            )}
            <p className="bag-empty-hint">{t.bagEmptyHint}</p>
          </div>
        ) : (
          <>
            <div className="bag-panel-list">
              <div className="bag-picked-row">
                <p className="bag-picked">
                  {t.bagPicked.replace(
                    "{count}",
                    countOf(lang, bag.length, ICON_FORMS[lang]),
                  )}
                </p>
                <button
                  ref={clearButton}
                  type="button"
                  className="bag-clear"
                  onClick={clear}
                >
                  {t.bagClear}
                </button>
              </div>
              <ul className="bag-list">
                {bag.map((name) => (
                  <li key={name} className="bag-item" data-icon={name}>
                    <Icon icon={name} className="bag-item-icon" />
                    <span className="bag-item-name">{name}</span>
                    <button
                      type="button"
                      className="bag-item-remove"
                      aria-label={t.bagRemove.replace("{name}", name)}
                      onClick={() => bagStore.remove(name)}
                    >
                      <Icon icon="material-symbols:close" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {applies.color || applies.stroke ? (
              <div className="bag-panel-section bag-options">
                {applies.color ? (
                  <ColorField lang={lang} value={color} onChange={setColor} />
                ) : null}
                {applies.stroke ? (
                  <StrokeField
                    lang={lang}
                    value={stroke}
                    onChange={setStroke}
                  />
                ) : null}
              </div>
            ) : null}
            {applies.color ? (
              <label className="bag-panel-section bag-without-fill">
                <span>{t.bagWithoutFill}</span>
                <input
                  type="checkbox"
                  className="bag-check-input"
                  checked={withoutFill}
                  onChange={(e) => setWithoutFill(e.target.checked)}
                />
                <Icon
                  icon={
                    withoutFill
                      ? "material-symbols:check-box"
                      : "material-symbols:check-box-outline-blank"
                  }
                  className="bag-check-icon"
                />
              </label>
            ) : null}
            <div className="bag-panel-section bag-downloads">
              <button
                type="button"
                className="bag-download"
                aria-disabled={busy}
                onClick={() => download("zip")}
              >
                <Icon
                  icon="material-symbols:folder-zip"
                  className="bag-download-icon"
                />
                <span>{t.bagZip}</span>
              </button>
              <button
                type="button"
                className="bag-download"
                aria-disabled={busy}
                onClick={() => download("sprite")}
              >
                <Icon icon="site:sprite" className="bag-download-icon" />
                <span>{t.bagSprite}</span>
              </button>
              {failed ? (
                <p className="bag-failed" role="alert">
                  {t.iconDownloadFailed}
                </p>
              ) : note !== undefined ? (
                <p className="bag-failed bag-missing" role="alert">
                  {note}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
