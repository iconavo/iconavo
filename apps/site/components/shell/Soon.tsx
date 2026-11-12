import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DICTIONARIES, type Lang } from "../../lib/i18n";

/**
 * Элемент макета, за которым в продукте пока ничего нет (решение владельца 12 ноября 2026): нарисован как
 * в макете, но не работает, а при наведении и фокусе показывает подсказку «Soon». Это кнопка с
 * aria-disabled: до неё доходит Tab, скринридер слышит «— soon» в имени. Подсказка — CSS ::after из
 * data-soon (globals.css), без JavaScript и без атрибута style: CSP сайта пускает стили только файлами.
 * above — подсказка над элементом (в подвале), иначе под ним.
 */
export function Soon({
  lang,
  className,
  children,
  label,
  above,
}: {
  lang: Lang;
  className?: string;
  children: ReactNode;
  /** Имя для скринридера, если на кнопке нет текста (аватар). */
  label?: string;
  above?: boolean;
}) {
  const t = DICTIONARIES[lang];
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-label={label === undefined ? undefined : `${label}${t.soonHint}`}
      data-soon={t.soon}
      className={cn("soon", above && "soon-above", className)}
    >
      {children}
      {label === undefined ? (
        <span className="sr-only">{t.soonHint}</span>
      ) : null}
    </button>
  );
}
