"use client";

import { useLayoutEffect } from "react";
import { setCollapsed, storedCollapsed } from "../lib/sidebar";
import { applyTheme, storedTheme } from "../lib/theme";

/**
 * Повтор выбора темы и свёрнутой панели после гидратации: в next dev строгий режим React сбрасывает
 * атрибуты <html>, которые поставил скрипт в <head>. В продакшен-сборке атрибуты уже на месте — повтор
 * ничего не меняет.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme(storedTheme());
    if (storedCollapsed()) setCollapsed(true);
  }, []);
  return null;
}
