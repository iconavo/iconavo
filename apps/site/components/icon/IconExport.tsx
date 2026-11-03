"use client";

import { useState } from "react";
import { track } from "../../lib/analytics";
import { bagStore, useBag } from "../../lib/bag";
import { copyPng } from "../../lib/clipboard";
import {
  type Applies,
  fileName,
  PNG_DEFAULT,
  PNG_SIZES,
  pngSvg,
} from "../../lib/code";
import { saveFile } from "../../lib/download";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import type { IconDetails } from "../../lib/icon";
import { useIconSettings } from "../../lib/icon-settings";
import { pngBlob } from "../../lib/png";
import { CopyButton } from "../CopyButton";
import { Button, buttonClass } from "../ui/button";
import { iconDataOf } from "./useIconData";

/**
 * Раздел «Скачать» (шаг 5 фазы 4, ADR-0042): PNG от 16 до 512 px — скачать или скопировать картинкой, как
 * у Iconify; его рисует браузер (lib/png.ts). Размеры PNG — кнопки, не ползунок: проверка панели считает
 * второй ползунок толщиной линии. «В сумку» — переключатель: иконка ложится в сумку шапки или уходит из
 * неё. SVG — главными кнопками под превью (IconActions). Скачивание и копирование — метки аналитики
 * (ADR-0043).
 */
export function IconExport({
  lang,
  name,
  details,
  applies,
  H,
}: {
  lang: Lang;
  name: string;
  /** До ответа API скачать нельзя: настройки, что применимо к иконке, ещё не известны. */
  details: IconDetails | undefined;
  applies: Applies;
  H: "h2" | "h3";
}) {
  const t = DICTIONARIES[lang];
  const s = useIconSettings();
  const [px, setPx] = useState<number>(PNG_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);
  const inBag = useBag().includes(name);
  const pressed = (on: boolean) =>
    buttonClass(on ? "primary" : "outline", "md", "icon-setting-toggle");

  /** PNG выбранного размера с настройками. */
  const png = async (): Promise<Blob> => {
    const icon = await iconDataOf(name);
    if (icon === null) throw new Error(`нет рисунка ${name}`);
    const drawing = pngSvg(icon, s, applies, px);
    return pngBlob(drawing.svg, drawing.width, drawing.height);
  };

  // Пока PNG готовится, кнопка не отключается — иначе браузер снял бы с неё фокус; повторный щелчок
  // просто не срабатывает (aria-disabled).
  async function download() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      saveFile(fileName(name, "png", px), await png(), "image/png");
      track({ name: "download", format: "png", icon: name, size: px });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="icon-section icon-export">
      <H className="icon-section-title">{t.iconDownload}</H>
      <p className="icon-download">
        <Button
          variant="outline"
          disabled={details === undefined}
          aria-disabled={busy}
          onClick={download}
        >
          {t.iconDownloadPng}
        </Button>
        <CopyButton
          className={buttonClass("outline")}
          icon={false}
          copy={() => copyPng(png())}
          labels={{ copy: t.iconCopyPng, copied: t.iconCopied }}
          disabled={details === undefined}
          onCopied={() =>
            track({ name: "copy", what: "png", icon: name, size: px })
          }
        />
        <Button
          variant={inBag ? "primary" : "outline"}
          aria-pressed={inBag}
          onClick={() => setFull(bagStore.toggle(name) === "full")}
        >
          {t.bagAdd}
        </Button>
      </p>
      {full ? (
        <p className="icon-setting-note" role="alert">
          {t.bagFull}
        </p>
      ) : null}
      <fieldset className="icon-setting">
        <legend className="icon-setting-label">{t.iconPngSize}</legend>
        <span className="icon-setting-buttons">
          {PNG_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className={pressed(n === px)}
              aria-pressed={n === px}
              onClick={() => setPx(n)}
            >
              {n}
            </button>
          ))}
        </span>
      </fieldset>
      {failed ? (
        <p className="icon-setting-note" role="alert">
          {t.iconDownloadFailed}
        </p>
      ) : null}
      <p className="icon-setting-note">{t.iconDownloadNote}</p>
    </section>
  );
}
