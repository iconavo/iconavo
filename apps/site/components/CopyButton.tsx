"use client";

import { Icon } from "@iconavo-ui/react";
import { useState } from "react";
import "../lib/iconavo";

/** Копировать код в буфер; «Copied» на две секунды — его слышит и скринридер. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
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
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
