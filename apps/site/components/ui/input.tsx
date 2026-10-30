// По образцу Input из shadcn/ui (MIT, © 2023 shadcn, https://ui.shadcn.com), на токенах сайта. Рамка —
// токен control: у поля она обязана быть заметной, 3:1 к фону (WCAG 1.4.11).

import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-control bg-bg px-3 text-base text-fg placeholder:text-muted disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
