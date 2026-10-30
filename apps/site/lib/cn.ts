/** Склеить классы, пропуская пустые: как clsx у shadcn/ui, без зависимости (решение владельца). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
