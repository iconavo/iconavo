import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Подсказка к значку «?» по макету (строка сведений набора): текст — при наведении и фокусе с
 * клавиатуры, из data-tip (CSS ::after в globals.css, как у «Soon»), без JavaScript и атрибута style.
 * Скринридер слышит текст как имя кнопки.
 */
export function Tip({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn("tip", className)}
      data-tip={text}
      aria-label={text}
    >
      {children}
    </button>
  );
}
