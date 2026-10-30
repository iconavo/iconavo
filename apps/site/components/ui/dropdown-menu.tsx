"use client";

// По образцу DropdownMenu из shadcn/ui (MIT, © 2023 shadcn, https://ui.shadcn.com) на radix-ui: код
// скопирован в проект и переписан на токены сайта (ADR-0038), иконки — @iconavo-ui/react, без анимаций
// (визуал — фаза 6). Меню всегда немодальное: модальное у Radix вставляет элемент <style>
// (react-remove-scroll), а CSP сайта пускает стили только файлами.

import { Icon } from "@iconavo-ui/react";
import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function DropdownMenu(
  props: Omit<ComponentProps<typeof Primitive.Root>, "modal">,
) {
  return <Primitive.Root modal={false} {...props} />;
}

export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 rounded-md border border-line bg-bg p-1 text-fg shadow-md",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-sm select-none focus-visible:-outline-offset-2 data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <Primitive.ItemIndicator>
          <Icon icon="lucide:check" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.RadioItem>
  );
}
