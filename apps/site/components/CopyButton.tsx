"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";
import { copyText } from "../lib/clipboard";
import "../lib/iconavo";

/**
 * Копировать текст в буфер; «Copied» на две секунды — его слышит и скринридер. Подписи — английские,
 * как в документации; панель иконки передаёт свои, на языке страницы. onCopied — метка аналитики
 * (ADR-0043): только после удачного копирования. Текст может готовиться (функция с обещанием) — тогда
 * запись идёт через ClipboardItem прямо в щелчке (lib/clipboard.ts); copy — своё копирование (PNG).
 * className — вид кнопки: по умолчанию тихая «copy», главная кнопка панели — кнопка сайта.
 */
export function CopyButton({
  text,
  copy,
  labels = { copy: "Copy", copied: "Copied" },
  label,
  onCopied,
  className = "copy",
  icon = true,
  disabled,
}: {
  text?: string | (() => Promise<string>);
  copy?: () => Promise<void>;
  labels?: { copy: string; copied: string };
  /** Подпись для скринридера, если видимой подписи мало: «Копировать имя». */
  label?: string;
  onCopied?: () => void;
  className?: string;
  /** Значок копирования рядом с подписью. */
  icon?: boolean;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      {...(label === undefined ? {} : { "aria-label": label })}
      onClick={async () => {
        try {
          if (copy !== undefined) await copy();
          else if (typeof text === "function") await copyText(text());
          else await copyText(text ?? "");
        } catch {
          // Буфер запрещён браузером — текст можно выделить и скопировать руками.
          return;
        }
        setCopied(true);
        onCopied?.();
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {icon ? (
        <Icon
          icon={copied ? "lucide:check" : "lucide:copy"}
          className="inline-block"
        />
      ) : null}
      <span aria-live="polite">{copied ? labels.copied : labels.copy}</span>
    </button>
  );
}
