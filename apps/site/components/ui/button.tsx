// По образцу Button из shadcn/ui (MIT, © 2023 shadcn, https://ui.shadcn.com): код скопирован в проект и
// переписан на токены сайта (ADR-0038). Варианты — таблица классов вместо class-variance-authority.

import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

const BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50";

const VARIANTS = {
  primary: "bg-accent text-bg hover:opacity-90",
  outline: "border border-control bg-bg text-fg hover:bg-surface",
  ghost: "text-fg hover:bg-surface",
} as const;

const SIZES = {
  md: "h-9 px-4",
  icon: "size-9",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/** Классы кнопки — и для ссылки, которая выглядит как кнопка. */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      {...props}
    />
  );
}
