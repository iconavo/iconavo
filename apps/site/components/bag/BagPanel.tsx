"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { track } from "../../lib/analytics";
import { bagPanelStore, bagStore, useBag, useBagPanel } from "../../lib/bag";
import { type BagLook, SPRITE_NAME, ZIP_NAME } from "../../lib/bag-files";
import { saveFile } from "../../lib/download";
import { countOf, ICON_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
// Хосты иконок — для ядра браузера: иконки рюкзака рисует оно (lib/iconavo.ts).
import "../../lib/iconavo";
import { ColorField, StrokeField } from "../panel/controls";

/** id панели — для aria-controls кнопок Bag. */
export const BAG_PANEL_ID = "bag-panel";

/** Телефон — как раскладка сайта (до 64rem): вместо панели справа — шторка снизу. */
const PHONE = "(max-width: 63.98rem)";

/** Протяжка ручки шторки вниз дальше этого — закрыть. */
const DRAG = 24;

/**
 * Рюкзак по макету (сценарий «Рюкзак», кадры Backpack и Backpack-Empty; решения владельца 13 ноября 2026):
 * на компьютере — панель справа во всю высоту поверх страницы, немодальная: сетку рядом можно листать и
 * класть иконки дальше; на телефоне — шторка почти на весь экран с затемнением. Внутри — «N icons
 * picked», список с ✕, внизу Color, Stroke Width, «Download SVG without fill color» (галочка — цвет
 * не вшивается в файлы, остаётся currentColor), Download ZIP и Download SVG Sprite. Clear — справа в строке
 * счётчика (в макете её нет; решение владельца 13 ноября 2026): рюкзак пустеет сразу, а пока панель
 * открыта, на месте списка — «Backpack cleared · Undo». Закрывают ✕, Esc и кнопка Bag; на телефоне ещё
 * протяжка ручки вниз и тап по затемнению. Фокус — на заголовок при открытии и обратно на кнопку при
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
  const [color, setColor] = useState<string>();
  const [stroke, setStroke] = useState<number>();
  const [withoutFill, setWithoutFill] = useState(false);
  const [applies, setApplies] = useState({ color: false, stroke: false });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Очищенный рюкзак — для «Undo»: предложение живёт, пока панель открыта и рюкзак пуст.
  const [cleared, setCleared] = useState<readonly string[]>();
  const clearedId = useId();
  const clearButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  // Открыть и закрыть: на компьютере — немодально, на телефоне — модально, с затемнением. Пока панель
  // открыта, у <html> — data-bag-panel: полоса прокрутки страницы спрятана, и панель встаёт вплотную к
  // краю окна (globals.css). Ширина полосы замеряется до того, как она спрячется: столько же отдаётся полю
  // справа, и страница не сдвигается — при любой полосе (Firefox с обычными полосами, сенсорный экран).
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    const root = document.documentElement;
    if (open && root.dataset.bagPanel === undefined) {
      root.style.setProperty(
        "--bag-page-lane",
        `${window.innerWidth - root.clientWidth}px`,
      );
      root.dataset.bagPanel = "";
    } else if (!open) {
      delete root.dataset.bagPanel;
      root.style.removeProperty("--bag-page-lane");
    }
    if (open && !el.open) {
      if (window.matchMedia(PHONE).matches) el.showModal();
      else el.show();
      heading.current?.focus();
    } else if (!open && el.open) {
      el.close();
      bagPanelStore.takeOpener()?.focus();
    }
  }, [open]);

  // Esc закрывает панель первой — раньше панели иконки (та слушает всплытие и пропускает обработанное).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      bagPanelStore.set(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

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
      .then((m) => m.bagIcons(bag).then((icons) => m.bagApplies(icons)))
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

  const look: BagLook = {
    ...(applies.color && color !== undefined && !withoutFill ? { color } : {}),
    ...(applies.stroke && stroke !== undefined ? { stroke } : {}),
  };

  // Пока файл готовится, строки не отключаются — иначе браузер снял бы с нажатой фокус; повторный щелчок
  // просто не срабатывает (aria-disabled).
  async function download(kind: "zip" | "sprite") {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const m = await import("../../lib/bag-export");
      if (kind === "zip") {
        saveFile(ZIP_NAME, await m.bagZip(bag, look), "application/zip");
      } else {
        saveFile(SPRITE_NAME, await m.bagSprite(bag, look), "image/svg+xml");
      }
      track({ name: "download", format: kind, count: bag.length });
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
          }}
          onPointerUp={(e) => {
            const from = drag.current;
            drag.current = undefined;
            if (from !== undefined && e.clientY - from > DRAG) {
              bagPanelStore.set(false);
            }
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onClick={() => bagPanelStore.set(false)}
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
              ) : null}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
