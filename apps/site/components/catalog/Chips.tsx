"use client";

import type { MouseEvent } from "react";

/** Клик без Ctrl, Cmd, Shift и Alt левой кнопкой — свой переход; иначе браузер откроет новую вкладку. */
export function plainClick(e: MouseEvent): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

export interface Chip {
  key: string;
  label: string;
  /** Число рядом с названием — уже на языке страницы. */
  count?: string;
  href: string;
  current: boolean;
  onSelect: () => void;
}

/**
 * Фильтр «чипсами»: обычные ссылки с параметрами адреса — работают и без JavaScript как ссылки, а со
 * скриптом меняют вид без перезагрузки. Только ссылки: компоненты Radix для выбора ставят стили, которые
 * не пускает CSP сайта (ADR-0038).
 */
export function Chips({ label, chips }: { label: string; chips: Chip[] }) {
  return (
    <nav aria-label={label} className="chips-nav">
      <span className="chips-label">{label}</span>
      <ul className="chips">
        {chips.map((chip) => (
          <li key={chip.key}>
            <a
              href={chip.href}
              className="chip"
              aria-current={chip.current ? "true" : undefined}
              onClick={(e) => {
                if (!plainClick(e)) return;
                e.preventDefault();
                chip.onSelect();
              }}
            >
              {chip.label}
              {chip.count === undefined ? null : (
                <span className="chip-count">{chip.count}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
