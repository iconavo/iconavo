"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";
import { track } from "../../lib/analytics";
import { bagStore, useBag } from "../../lib/bag";
import { copyText } from "../../lib/clipboard";
import {
  type Applies,
  fileComment,
  fileName,
  fileSvg,
  svgFile,
} from "../../lib/code";
import { saveFile } from "../../lib/download";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import type { IconSetSummary } from "../../lib/icon";
import type { IconSettings } from "../../lib/icon-settings";
import { panelSettings } from "../../lib/panel-code";
import { iconDataOf } from "../icon/useIconData";
import { useCopied } from "./parts";

/**
 * Действия панели по макету: Copy Icon — единственная главная кнопка (accent/lemon), копирует код SVG с
 * настройками — в Figma он вставляется вектором (решения владельца 3 ноября 2026); Download — файл SVG,
 * первой строкой комментарий об авторе и лицензии; «+ рюкзак» — в сумку или из неё.
 */
export function PanelActions({
  lang,
  name,
  s,
  applies,
  set,
}: {
  lang: Lang;
  name: string;
  s: IconSettings;
  applies: Applies;
  /** Набор — для комментария файла; до ответа каталога скачивание недоступно. */
  set: IconSetSummary | undefined;
}) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const inBag = bag.includes(name);
  const [copied, done] = useCopied();
  const [busy, setBusy] = useState(false);
  const settings = panelSettings(s);

  const svg = async () => {
    const icon = await iconDataOf(name);
    if (icon === null) throw new Error(`нет рисунка ${name}`);
    return fileSvg(icon, settings, applies);
  };

  // Пока файл готовится, кнопка не отключается — иначе браузер снял бы с неё фокус.
  async function download() {
    if (set === undefined || busy) return;
    setBusy(true);
    try {
      const icon = await iconDataOf(name);
      if (icon === null) return;
      saveFile(
        fileName(name, "svg"),
        svgFile(icon, settings, applies, fileComment(name, { set })),
        "image/svg+xml",
      );
      track({ name: "download", format: "svg", icon: name });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-actions">
      <button
        type="button"
        className="panel-btn panel-btn-primary"
        onClick={async () => {
          try {
            await copyText(svg());
          } catch {
            return;
          }
          done();
          track({ name: "copy", what: "icon", icon: name });
        }}
      >
        <Icon
          icon={
            copied ? "material-symbols:check" : "material-symbols:content-copy"
          }
          className="panel-icon"
        />
        {/* Ширина кнопки — по более длинной из двух надписей: «Copied» не сдвигает соседей. */}
        <span className="label-swap">
          <span aria-hidden="true">{t.pCopyIcon}</span>
          <span aria-hidden="true">{t.pCopyIconDone}</span>
          <span aria-live="polite">
            {copied ? t.pCopyIconDone : t.pCopyIcon}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="panel-btn panel-btn-secondary"
        aria-disabled={set === undefined || busy}
        onClick={download}
      >
        <Icon
          icon="material-symbols:download"
          className="panel-icon panel-icon-muted"
        />
        <span>{t.pDownload}</span>
      </button>
      <button
        type="button"
        className="panel-btn panel-btn-outline panel-bag"
        aria-pressed={inBag}
        aria-label={inBag ? t.pBagRemove : t.pBagAdd}
        onClick={() => bagStore.toggle(name)}
      >
        <span aria-hidden="true">{inBag ? "✓" : "+"}</span>
        <Icon icon="material-symbols:backpack" className="panel-icon" />
      </button>
    </div>
  );
}
