"use client";

import { useState } from "react";
import { track } from "../../lib/analytics";
import { bagStore, useBag } from "../../lib/bag";
import {
  type Applies,
  fileComment,
  fileName,
  PNG_DEFAULT,
  PNG_SIZES,
  pngSvg,
  svgFile,
} from "../../lib/code";
import { saveFile } from "../../lib/download";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import type { IconDetails } from "../../lib/icon";
import { useIconSettings } from "../../lib/icon-settings";
import { pngBlob } from "../../lib/png";
import { Button, buttonClass } from "../ui/button";
import { iconDataOf } from "./useIconData";

/**
 * Скачивание иконки (шаг 5 фазы 4, ADR-0042): SVG с настройками и комментарием об авторе и лицензии,
 * PNG от 16 до 512 px — его рисует браузер (lib/png.ts). Размеры PNG — кнопки, не ползунок: проверка
 * панели считает второй ползунок толщиной линии. Скачивание — метка аналитики (ADR-0043). «В сумку» —
 * переключатель: иконка ложится в сумку шапки или уходит из неё (шаг 5 фазы 4, решение владельца).
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
  /** Набор, автор и лицензия — для комментария файла; до ответа API скачать нельзя. */
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

  async function download(format: "svg" | "png") {
    if (details === undefined) return;
    setBusy(true);
    setFailed(false);
    try {
      const icon = await iconDataOf(name);
      if (icon === null) throw new Error(`нет рисунка ${name}`);
      if (format === "svg") {
        saveFile(
          fileName(name, "svg"),
          svgFile(icon, s, applies, fileComment(name, details)),
          "image/svg+xml",
        );
        track({ name: "download", format, icon: name });
      } else {
        const png = pngSvg(icon, s, applies, px);
        saveFile(
          fileName(name, "png", px),
          await pngBlob(png.svg, png.width, png.height),
          "image/png",
        );
        track({ name: "download", format, icon: name, size: px });
      }
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
          disabled={details === undefined || busy}
          onClick={() => download("svg")}
        >
          {t.iconDownloadSvg}
        </Button>
        <Button
          variant="outline"
          disabled={details === undefined || busy}
          onClick={() => download("png")}
        >
          {t.iconDownloadPng}
        </Button>
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
