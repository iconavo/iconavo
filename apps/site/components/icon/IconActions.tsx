"use client";

import { useState } from "react";
import { track } from "../../lib/analytics";
import {
  type Applies,
  fileComment,
  fileName,
  fileSvg,
  svgFile,
} from "../../lib/code";
import { saveFile } from "../../lib/download";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import type { IconDetails } from "../../lib/icon";
import { useIconSettings } from "../../lib/icon-settings";
import { CopyButton } from "../CopyButton";
import { Button, buttonClass } from "../ui/button";
import { iconDataOf } from "./useIconData";

/**
 * Главные действия под превью (шаг 5 фазы 4; решения владельца 3 ноября 2026): «Скопировать иконку» и
 * «Скачать SVG» — «нашёл, скопировал, вставил» за один щелчок. Копируется код SVG с настройками, как у
 * Iconify: размер в пикселях — родной у сетки набора, если его не меняли, цвет, толщина, поворот и
 * отражение. В Figma, Sketch и Illustrator он вставляется вектором. В скачанном файле первой строкой —
 * комментарий об авторе и лицензии, в буфере его нет: при вставке он только мешает.
 */
export function IconActions({
  lang,
  name,
  details,
  applies,
}: {
  lang: Lang;
  name: string;
  /** Набор, автор и лицензия — для комментария файла; до ответа API действия недоступны. */
  details: IconDetails | undefined;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  const s = useIconSettings();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const svg = async () => {
    const icon = await iconDataOf(name);
    if (icon === null) throw new Error(`нет рисунка ${name}`);
    return fileSvg(icon, s, applies);
  };

  // Пока файл готовится, кнопка не отключается — иначе браузер снял бы с неё фокус; повторный щелчок
  // просто не срабатывает (aria-disabled).
  async function download() {
    if (details === undefined || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const icon = await iconDataOf(name);
      if (icon === null) throw new Error(`нет рисунка ${name}`);
      saveFile(
        fileName(name, "svg"),
        svgFile(icon, s, applies, fileComment(name, details)),
        "image/svg+xml",
      );
      track({ name: "download", format: "svg", icon: name });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="icon-actions">
        <CopyButton
          className={buttonClass("primary")}
          text={svg}
          labels={{ copy: t.iconCopyIcon, copied: t.iconCopied }}
          disabled={details === undefined}
          onCopied={() => track({ name: "copy", what: "icon", icon: name })}
        />
        <Button
          variant="outline"
          disabled={details === undefined}
          aria-disabled={busy}
          onClick={download}
        >
          {t.iconDownloadSvg}
        </Button>
      </p>
      {failed ? (
        <p className="icon-setting-note" role="alert">
          {t.iconDownloadFailed}
        </p>
      ) : null}
    </>
  );
}
