"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";
import "../lib/iconavo";

/**
 * Копировать текст в буфер; «Copied» на две секунды — его слышит и скринридер. Подписи — английские,
 * как в документации; панель иконки передаёт свои, на языке страницы.
 */
export function CopyButton({
  text,
  labels = { copy: "Copy", copied: "Copied" },
  label,
}: {
  text: string;
  labels?: { copy: string; copied: string };
  /** Подпись для скринридера, если видимой подписи мало: «Копировать имя». */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      {...(label === undefined ? {} : { "aria-label": label })}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon
        icon={copied ? "lucide:check" : "lucide:copy"}
        className="inline-block"
      />
      <span aria-live="polite">{copied ? labels.copied : labels.copy}</span>
    </button>
  );
}
