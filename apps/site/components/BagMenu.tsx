"use client";

import { Icon } from "@iconavo-ui/react";
import { useEffect, useId, useState } from "react";
import { track } from "../lib/analytics";
import { bagStore, useBag } from "../lib/bag";
import { type BagLook, SPRITE_NAME, ZIP_NAME } from "../lib/bag-files";
import { getSets, type SetInfo } from "../lib/catalog";
import { saveFile } from "../lib/download";
import { countOf, ICON_FORMS } from "../lib/format";
import { DICTIONARIES, type Lang } from "../lib/i18n";
import {
  COLOR_START,
  parseColor,
  STROKE_DEFAULT,
  STROKE_MAX,
  STROKE_MIN,
  STROKE_STEP,
} from "../lib/icon-settings";
// Хосты иконок — для ядра браузера: иконки сумки грузит оно само (lib/iconavo.ts).
import "../lib/iconavo";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * Сумка в шапке (шаг 5 фазы 4, ADR-0042; решения владельца 3 ноября 2026): кнопка с числом иконок и
 * немодальное меню — список, «Убрать», «Очистить», общий цвет и толщина линии, ZIP и SVG-спрайт. Число —
 * значком поверх кнопки, после гидратации: шапка не сдвигается. Сборка файлов (lib/bag-export.ts)
 * грузится по щелчку. Скачивание — метка аналитики (ADR-0043).
 */
export function BagMenu({
  lang,
  defaultOpen = false,
}: {
  lang: Lang;
  /** Меню открыто сразу — для Storybook. */
  defaultOpen?: boolean;
}) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [look, setLook] = useState<BagLook>({});
  const [applies, setApplies] = useState({ color: false, stroke: false });
  const [sets, setSets] = useState<Record<string, SetInfo>>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = countOf(lang, bag.length, ICON_FORMS[lang]);

  // Что применимо к сумке и лицензии наборов — когда меню открыто.
  useEffect(() => {
    if (!open || bag.length === 0) return;
    let live = true;
    import("../lib/bag-export")
      .then((m) => m.bagIcons(bag).then((icons) => m.bagApplies(icons)))
      .then(
        (a) => {
          if (live) setApplies(a);
        },
        () => {},
      );
    getSets().then(
      (s) => {
        if (live) setSets(s);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open, bag]);

  const prefixes = [...new Set(bag.map((n) => n.slice(0, n.indexOf(":"))))];
  const licenses = prefixes
    .map((p) => {
      const info = sets?.[p];
      return info === undefined ? p : `${info.name} (${info.license.title})`;
    })
    .join(", ");
  const used: BagLook = {
    ...(applies.color && look.color !== undefined ? { color: look.color } : {}),
    ...(applies.stroke && look.stroke !== undefined
      ? { stroke: look.stroke }
      : {}),
  };

  // Пока файл готовится, кнопки не отключаются — иначе браузер снял бы с нажатой фокус и меню потеряло
  // бы его; повторный щелчок просто не срабатывает (aria-disabled).
  async function download(kind: "zip" | "sprite") {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const m = await import("../lib/bag-export");
      if (kind === "zip") {
        saveFile(ZIP_NAME, await m.bagZip(bag, used), "application/zip");
      } else {
        saveFile(SPRITE_NAME, await m.bagSprite(bag, used), "image/svg+xml");
      }
      track({ name: "download", format: kind, count: bag.length });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="bag-button"
          aria-label={
            bag.length === 0 ? t.bag : t.bagLabel.replace("{count}", count)
          }
        >
          <Icon icon="lucide:shopping-bag" />
          {bag.length > 0 ? (
            <span className="bag-count" aria-hidden="true">
              {bag.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="bag-menu" aria-labelledby={`${id}-title`}>
        <div className="bag-head">
          <h2 id={`${id}-title`} className="bag-title">
            {t.bag}
            {bag.length > 0 ? ` · ${count}` : ""}
          </h2>
          {bag.length > 0 ? (
            <Button variant="ghost" onClick={() => bagStore.clear()}>
              {t.bagClear}
            </Button>
          ) : null}
        </div>
        {bag.length === 0 ? (
          <p className="bag-empty">{t.bagEmpty}</p>
        ) : (
          <>
            <ul className="bag-list">
              {bag.map((name) => (
                <li key={name} data-icon={name}>
                  <Icon icon={name} className="bag-svg" />
                  <code className="bag-name">{name}</code>
                  <button
                    type="button"
                    className="bag-remove"
                    aria-label={t.bagRemove.replace("{name}", name)}
                    onClick={() => bagStore.remove(name)}
                  >
                    <Icon icon="lucide:x" className="inline-block" />
                  </button>
                </li>
              ))}
            </ul>
            {applies.color ? (
              <div className="icon-setting">
                <label htmlFor={`${id}-custom`}>
                  <input
                    id={`${id}-custom`}
                    type="checkbox"
                    checked={look.color !== undefined}
                    onChange={(e) => {
                      const { color: _, ...rest } = look;
                      setLook(
                        e.target.checked
                          ? { ...rest, color: COLOR_START }
                          : rest,
                      );
                    }}
                  />{" "}
                  {t.iconColorCustom}
                </label>
                <input
                  type="color"
                  aria-label={t.iconColor}
                  value={look.color ?? COLOR_START}
                  onChange={(e) => {
                    const color = parseColor(e.target.value);
                    if (color !== undefined) setLook({ ...look, color });
                  }}
                />
              </div>
            ) : null}
            {applies.stroke ? (
              <div className="icon-setting">
                <label htmlFor={`${id}-stroke`}>{t.iconStroke}</label>
                <input
                  id={`${id}-stroke`}
                  type="range"
                  min={STROKE_MIN}
                  max={STROKE_MAX}
                  step={STROKE_STEP}
                  value={look.stroke ?? STROKE_DEFAULT}
                  onChange={(e) =>
                    setLook({ ...look, stroke: Number(e.target.value) })
                  }
                />
                <output htmlFor={`${id}-stroke`}>
                  {look.stroke ?? STROKE_DEFAULT}
                </output>
              </div>
            ) : null}
            <p className="icon-download">
              <Button
                variant="outline"
                aria-disabled={busy}
                onClick={() => download("zip")}
              >
                {t.bagZip}
              </Button>
              <Button
                variant="outline"
                aria-disabled={busy}
                onClick={() => download("sprite")}
              >
                {t.bagSprite}
              </Button>
            </p>
            {failed ? (
              <p className="icon-setting-note" role="alert">
                {t.iconDownloadFailed}
              </p>
            ) : null}
            <p className="icon-setting-note">
              {t.bagLicenses.replace("{sets}", licenses)}
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
