"use client";

import { Icon } from "@iconavo-ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { cn } from "../../lib/cn";
import { saveFile } from "../../lib/download";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import "../../lib/iconavo";
import { Soon } from "../shell/Soon";

// Детали панели иконки по макету «Icon Panel» (Figma «Iconavo — Макеты», раздел 02 · Parts): Code Block,
// Pill, Option и вкладки. Значки — Material Symbols, как в макете.

/** Копирование с состоянием «Copied» на 2 секунды (макет: State=Copied — зелёная галочка). */
export function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    copied,
    () => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    },
  ];
}

/**
 * «Copy» в шапке блока кода и кнопка Copy рядом с полем Name. Текст может готовиться (рисунок иконки
 * приходит не сразу) — тогда запись в буфер идёт прямо в щелчке (lib/clipboard.ts). what — что копируется:
 * скринридер слышит «Copy Install».
 */
export function PanelCopy({
  lang,
  text,
  what,
  className = "code-copy",
  icon = "material-symbols:content-copy",
  label,
  onCopied,
}: {
  lang: Lang;
  text: string | (() => Promise<string>);
  what?: string;
  className?: string;
  /** Значок до копирования; после — галочка. */
  icon?: string;
  /** Видимая подпись вместо «Copy»: «Copy as data URL». */
  label?: string;
  onCopied?: () => void;
}) {
  const t = DICTIONARIES[lang];
  const [copied, done] = useCopied();
  return (
    <button
      type="button"
      className={className}
      data-copied={copied ? "" : undefined}
      onClick={async () => {
        try {
          await copyText(typeof text === "function" ? text() : text);
        } catch {
          // Буфер запрещён браузером — код можно выделить и скопировать руками.
          return;
        }
        done();
        onCopied?.();
      }}
    >
      <Icon
        icon={copied ? "material-symbols:check" : icon}
        className="panel-icon"
      />
      <span aria-live="polite">{copied ? t.pCopied : (label ?? t.pCopy)}</span>
      {what === undefined ? null : <span className="sr-only"> {what}</span>}
    </button>
  );
}

/**
 * Блок кода (Icon Panel/Code Block): подпись, скачивание (Show download), Copy и сам код. limited —
 * длинный код: 160 px и прокрутка; такой блок получает фокус с клавиатуры, чтобы его можно было листать.
 */
export function CodeBlock({
  lang,
  label,
  code,
  limited,
  download,
  onCopied,
}: {
  lang: Lang;
  label: string;
  code: string;
  limited?: boolean;
  /** Скачать код файлом: имя и тип. */
  download?: { name: string; type: string };
  onCopied?: () => void;
}) {
  const t = DICTIONARIES[lang];
  return (
    <figure className="code-block">
      <figcaption className="code-block-head">
        <span className="code-block-label">{label}</span>
        <span className="code-block-actions">
          {download === undefined ? null : (
            <button
              type="button"
              className="code-download"
              aria-label={`${t.pDownloadFile}: ${download.name}`}
              onClick={() => saveFile(download.name, code, download.type)}
            >
              <Icon icon="material-symbols:download" className="panel-icon" />
            </button>
          )}
          <PanelCopy lang={lang} text={code} what={label} onCopied={onCopied} />
        </span>
      </figcaption>
      <pre
        className={cn("code-block-code", limited && "code-block-limited")}
        tabIndex={limited ? 0 : undefined}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/**
 * Таблетка-переключатель (Icon Panel/Pill): Default, Hover, Selected (accent/mint), Focus. Формата, которого
 * в продукте нет, — «Soon».
 */
export function Pill({
  lang,
  selected,
  soon,
  logo,
  onSelect,
  children,
}: {
  lang: Lang;
  selected?: boolean;
  soon?: boolean;
  /** Адрес логотипа 16 × 16 (public/logos): украшение, название написано рядом. */
  logo?: string;
  onSelect?: () => void;
  children: ReactNode;
}) {
  const content = (
    <>
      {logo === undefined ? null : (
        // biome-ignore lint/performance/noImgElement: маленький SVG-файл, оптимизация next/image ему не нужна
        <img src={logo} alt="" width={16} height={16} className="pill-logo" />
      )}
      {children}
    </>
  );
  if (soon) {
    return (
      <Soon lang={lang} className="pill-option">
        {content}
      </Soon>
    );
  }
  return (
    <button
      type="button"
      className="pill-option"
      aria-pressed={selected === true}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

/** Группа таблеток с подписью над ними (SVG and CSS, Components, Package manager). */
export function PillGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="pill-group">
      <legend className="panel-label">{label}</legend>
      <div className="pill-row">{children}</div>
    </fieldset>
  );
}

/** Вкладка подвида кода: выбранная — с чертой снизу; чего нет — «Soon». */
export function PanelTab({
  lang,
  selected,
  soon,
  onSelect,
  children,
}: {
  lang: Lang;
  selected?: boolean;
  soon?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  if (soon) {
    return (
      <Soon lang={lang} className="panel-tab">
        {children}
      </Soon>
    );
  }
  return (
    <button
      type="button"
      className="panel-tab"
      aria-pressed={selected === true}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

/** Строка вкладок с линией под ней. */
export function PanelTabs({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="panel-tabs">
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  );
}

/** Настройка вывода (Icon Panel/Option, Type=Checkbox): флажок — значками Material Symbols, как в макете. */
export function PanelOption({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="panel-option">
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <Icon
        icon={
          checked
            ? "material-symbols:check-box"
            : "material-symbols:check-box-outline-blank"
        }
        className="panel-option-box"
      />
      <span>{children}</span>
    </label>
  );
}
