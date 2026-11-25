"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";
import { track } from "../../lib/analytics";
import { BAG_LIMIT, bagStore, useBag } from "../../lib/bag";
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
import type { IconDetails, IconSetSummary } from "../../lib/icon";
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
  credits,
}: {
  lang: Lang;
  name: string;
  s: IconSettings;
  applies: Applies;
  /** Набор — для комментария файла; до ответа каталога скачивание недоступно. */
  set: IconSetSummary | undefined;
  /** Части иконки от других авторов (Feather у Lucide) из /icon — в комментарий файла (ревизия фазы 5, С-19). */
  credits?: IconDetails["credits"];
}) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const inBag = bag.includes(name);
  // Сумка полна — кнопка так и говорит, а не молчит (ревизия фазы 5, С-14).
  const bagFull = !inBag && bag.length >= BAG_LIMIT;
  const fullText = t.bagFull.replace("{max}", String(BAG_LIMIT));
  const [copied, done] = useCopied();
  const [busy, setBusy] = useState(false);
  const settings = panelSettings(s);

  const svg = async () => {
    const icon = await iconDataOf(name);
    if (icon === null) throw new Error(`нет рисунка ${name}`);
    return fileSvg(icon, settings, applies);
  };

  // Пока файл готовится, кнопка не отключается — иначе браузер снял бы с неё фокус. Сбой сети при загрузке
  // рисунка — без файла и без необработанного отказа (ревизия фазы 5, С-21).
  async function download() {
    if (set === undefined || busy) return;
    setBusy(true);
    try {
      const icon = await iconDataOf(name);
      if (icon === null) return;
      const comment = fileComment(name, {
        set,
        ...(credits === undefined ? {} : { credits }),
      });
      saveFile(
        fileName(name, "svg"),
        svgFile(icon, settings, applies, comment),
        "image/svg+xml",
      );
      track({ name: "download", format: "svg", icon: name });
    } catch {
      // Рисунок не загрузился — файла нет; следующий щелчок попробует ещё раз.
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
        aria-disabled={bagFull || undefined}
        title={bagFull ? fullText : undefined}
        aria-label={bagFull ? fullText : inBag ? t.pBagRemove : t.pBagAdd}
        onClick={() => bagStore.toggle(name)}
      >
        <span aria-hidden="true">{inBag ? "✓" : "+"}</span>
        <Icon icon="material-symbols:backpack" className="panel-icon" />
      </button>
    </div>
  );
}
