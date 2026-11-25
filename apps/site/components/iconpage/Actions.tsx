"use client";

import { Icon } from "@iconavo-ui/react";
import { useRef, useState } from "react";
import { type CopyWhat, track } from "../../lib/analytics";
import { BAG_LIMIT, bagStore, useBag } from "../../lib/bag";
import { copyPng, copyText } from "../../lib/clipboard";
import {
  type Applies,
  fileName,
  fileSvg,
  pngSvg,
  svgFile,
} from "../../lib/code";
import { saveFile } from "../../lib/download";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import {
  COPY_FORMATS,
  type CopyFormat,
  downloadComment,
  type IconPageData,
  PNG_SCALES,
  svgBase64,
  svgToJsx,
} from "../../lib/icon-page";
import type { IconSettings } from "../../lib/icon-settings";
import { svgDataUrl } from "../../lib/panel-code";
import { pngBlob } from "../../lib/png";
import { copyFormatStore, useChoice } from "../../lib/prefs";
import { PageLink } from "../PageLink";
import { useCopied } from "../panel/parts";
import { ChoiceMenu } from "./ChoiceMenu";

/** Названия форматов — одни на обоих языках, кроме картинки PNG. */
const FORMAT_NAMES: Record<Exclude<CopyFormat, "png">, string> = {
  svg: "SVG",
  jsx: "JSX",
  "data-url": "Data URL",
  base64: "Base64",
};

const COPY_WHAT: Record<CopyFormat, CopyWhat> = {
  svg: "icon",
  jsx: "jsx",
  "data-url": "data-url",
  base64: "base64",
  png: "png",
};

/** Текст для буфера в формате; картинка PNG — отдельно. */
function copyTextOf(
  format: Exclude<CopyFormat, "png">,
  page: IconPageData,
  s: IconSettings,
  applies: Applies,
): string {
  const svg = fileSvg(page.data, s, applies);
  if (format === "jsx") return svgToJsx(svg);
  if (format === "data-url") return svgDataUrl(svg);
  if (format === "base64") return svgBase64(svg);
  return svg;
}

/** PNG выбранного размера, свой цвет или чёрный (lib/code.ts pngSvg); рисует браузер. */
function png(
  page: IconPageData,
  s: IconSettings,
  applies: Applies,
  px: number,
): Promise<Blob> {
  const { svg, width, height } = pngSvg(page.data, s, applies, px);
  return pngBlob(svg, width, height);
}

/**
 * Copy SVG ▾ по макету: главное действие копирует в выбранном формате, стрелка открывает выбор — SVG,
 * JSX, Data URL, Base64, картинка PNG. Выбор запоминается и подставляется в кнопку (гайд макета) и
 * сразу копирует. После копирования — «Copied» на 2 секунды; ширина кнопки — по более длинной надписи.
 */
export function CopyAction({
  lang,
  page,
  s,
  applies,
}: {
  lang: Lang;
  page: IconPageData;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  const format = useChoice(copyFormatStore);
  const [copied, done] = useCopied();
  const split = useRef<HTMLDivElement>(null);
  const name = (f: CopyFormat) => (f === "png" ? "PNG" : FORMAT_NAMES[f]);
  // Формат — отдельным элементом: на телефоне по-русски кнопка без него («Копировать ▾»), иначе рядом
  // со «Скачать» и сумкой не помещается; выбранный формат отмечен в шторке.
  const [before = "", after = ""] = t.ipCopyFormat.split("{format}");
  const labelParts = (
    <>
      {before}
      <span className="ip-copy-format">{name(format)}</span>
      {after}
    </>
  );

  async function copy(f: CopyFormat) {
    try {
      if (f === "png") await copyPng(png(page, s, applies, s.size));
      else await copyText(copyTextOf(f, page, s, applies));
    } catch {
      // Буфер запрещён браузером — код есть во вкладке Code, файл — в Download.
      return;
    }
    done();
    track({
      name: "copy",
      what: COPY_WHAT[f],
      icon: page.icon,
      ...(f === "png" ? { size: s.size } : {}),
    });
  }

  return (
    <div ref={split} className="ip-split">
      <button
        type="button"
        className="ip-split-main panel-btn panel-btn-primary"
        onClick={() => copy(format)}
      >
        <Icon
          icon={
            copied ? "material-symbols:check" : "material-symbols:content-copy"
          }
          className="panel-icon"
        />
        <span className="label-swap">
          <span aria-hidden="true">{labelParts}</span>
          <span aria-hidden="true">{t.pCopyIconDone}</span>
          <span aria-live="polite">
            {copied ? t.pCopyIconDone : labelParts}
          </span>
        </span>
      </button>
      <ChoiceMenu
        lang={lang}
        title={t.ipCopyAs}
        titleIcon="material-symbols:content-copy"
        items={COPY_FORMATS.map((f) => ({
          id: f,
          label: f === "png" ? t.ipPngImage : FORMAT_NAMES[f],
          checked: f === format,
          separated: f === "png",
        }))}
        anchor={split}
        onChoose={(id) => {
          const f = id as CopyFormat;
          copyFormatStore.set(f);
          void copy(f);
        }}
      >
        <button
          type="button"
          className="ip-split-arrow panel-btn panel-btn-primary"
          aria-label={t.ipChooseFormat}
        >
          <Icon
            icon="material-symbols:keyboard-arrow-down"
            className="panel-icon"
          />
        </button>
      </ChoiceMenu>
    </div>
  );
}

/** Файл SVG с комментарием об авторе и лицензии (ADR-0042) и имя файла. */
function svgDownload(page: IconPageData, s: IconSettings, applies: Applies) {
  saveFile(
    fileName(page.icon, "svg"),
    svgFile(page.data, s, applies, downloadComment(page)),
    "image/svg+xml",
  );
  track({ name: "download", format: "svg", icon: page.icon });
}

/**
 * Download ▾: файл SVG и PNG выбранного размера, вдвое и вчетверо больше (меню в макете не нарисовано —
 * решение владельца 13 ноября 2026). Пока PNG готовится, кнопка не отключается — иначе браузер снял бы с
 * неё фокус.
 */
export function DownloadAction({
  lang,
  page,
  s,
  applies,
}: {
  lang: Lang;
  page: IconPageData;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  const [busy, setBusy] = useState(false);

  async function download(id: string) {
    if (id === "svg") {
      svgDownload(page, s, applies);
      return;
    }
    if (busy) return;
    const px = s.size * Number(id);
    setBusy(true);
    try {
      saveFile(
        fileName(page.icon, "png", px),
        await png(page, s, applies, px),
        "image/png",
      );
      track({ name: "download", format: "png", icon: page.icon, size: px });
    } catch {
      // Рисунок не отрисовался — кнопка остаётся, можно повторить.
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChoiceMenu
      lang={lang}
      title={t.pDownload}
      titleIcon="material-symbols:download"
      items={[
        { id: "svg", label: t.ipDownloadSvg },
        ...PNG_SCALES.map((k, i) => ({
          id: String(k),
          label: `PNG ${k}× · ${s.size * k} px`,
          separated: i === 0,
        })),
      ]}
      onChoose={(id) => void download(id)}
    >
      <button
        type="button"
        className="panel-btn panel-btn-secondary ip-download"
        aria-label={`${t.pDownload}. ${t.ipDownloadMenu}`}
        aria-disabled={busy}
      >
        <Icon
          icon="material-symbols:download"
          className="panel-icon panel-icon-muted"
        />
        <span>{t.pDownload}</span>
        <Icon
          icon="material-symbols:keyboard-arrow-down"
          className="panel-icon"
        />
      </button>
    </ChoiceMenu>
  );
}

/**
 * Add to backpack — в сумку или из неё (ADR-0042). На телефоне — «+» с рюкзаком, как в панели иконки:
 * так три кнопки помещаются в строку (гайд макета).
 */
export function BagAction({ lang, icon }: { lang: Lang; icon: string }) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const inBag = bag.includes(icon);
  // Сумка полна — кнопка так и пишет, а не молчит (ревизия фазы 5, С-14).
  const bagFull = !inBag && bag.length >= BAG_LIMIT;
  const fullText = t.bagFull.replace("{max}", String(BAG_LIMIT));
  return (
    <button
      type="button"
      className="panel-btn panel-btn-outline ip-bag"
      aria-pressed={inBag}
      aria-disabled={bagFull || undefined}
      title={bagFull ? fullText : undefined}
      aria-label={bagFull ? fullText : inBag ? t.ipBagIn : t.ipBagAdd}
      onClick={() => bagStore.toggle(icon)}
    >
      <Icon
        icon={inBag ? "material-symbols:check" : "site:backpack-add"}
        className="panel-icon ip-bag-wide"
      />
      <span className="ip-bag-wide">
        {bagFull ? t.ipBagFull : inBag ? t.ipBagIn : t.ipBagAdd}
      </span>
      <span className="ip-bag-narrow">{inBag ? "✓" : "+"}</span>
      <Icon
        icon="material-symbols:backpack"
        className="panel-icon ip-bag-narrow"
      />
    </button>
  );
}

/** Действия скрытой иконки (состояние Removed): последняя версия файлом и страница набора. */
export function RemovedActions({
  lang,
  page,
  s,
  applies,
}: {
  lang: Lang;
  page: IconPageData;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  return (
    <div className="ip-actions ip-actions-removed">
      <button
        type="button"
        className="panel-btn panel-btn-secondary"
        onClick={() => svgDownload(page, s, applies)}
      >
        <Icon
          icon="material-symbols:download"
          className="panel-icon panel-icon-muted"
        />
        <span>{t.ipDownloadLast}</span>
      </button>
      <PageLink
        lang={lang}
        path={`/${page.set.prefix}`}
        className="panel-btn panel-btn-outline ip-open-set"
      >
        <Icon icon="material-symbols:open-in-new" className="panel-icon" />
        <span>{t.ipOpenSet.replace("{set}", page.set.name)}</span>
      </PageLink>
    </div>
  );
}
