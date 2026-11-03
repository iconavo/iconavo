"use client";

// По образцу Popover из shadcn/ui (MIT, © 2023 shadcn, https://ui.shadcn.com) на radix-ui: код
// скопирован в проект и переписан на токены сайта (ADR-0038), без анимаций (визуал — фаза 6). Окно
// всегда немодальное: модальное у Radix вставляет элемент <style> (react-remove-scroll), а CSP сайта
// пускает стили только файлами. Немодальное закрывают Esc и щелчок вне окна, фокус возвращается на
// кнопку.

import { Popover as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Popover(
  props: Omit<ComponentProps<typeof Primitive.Root>, "modal">,
) {
  return <Primitive.Root modal={false} {...props} />;
}

export const PopoverTrigger = Primitive.Trigger;
export const PopoverClose = Primitive.Close;

export function PopoverContent({
  className,
  align = "end",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 rounded-md border border-line bg-bg p-3 text-fg shadow-md",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
