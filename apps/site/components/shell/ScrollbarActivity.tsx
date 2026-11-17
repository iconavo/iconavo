"use client";

import { useEffect } from "react";
import { trackScrolling } from "../../lib/scrollbars";

/**
 * Полосы прокрутки видны только при прокрутке: элемент, который прокручивают, получает пометку
 * data-scrolling (lib/scrollbars.ts), стили бегунка — в app/globals.css. Ничего не рисует.
 */
export function ScrollbarActivity() {
  useEffect(() => trackScrolling(document), []);
  return null;
}
