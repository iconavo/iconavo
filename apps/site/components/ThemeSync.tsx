"use client";

import { useLayoutEffect } from "react";
import { applyTheme, storedTheme } from "../lib/theme";

/**
 * Повтор выбора темы после гидратации: в next dev строгий режим React сбрасывает атрибуты <html>,
 * которые поставил скрипт в <head>. В продакшен-сборке атрибут уже на месте — повтор ничего не меняет.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme(storedTheme());
  }, []);
  return null;
}
