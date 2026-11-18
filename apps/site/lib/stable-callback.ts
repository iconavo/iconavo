"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Обработчик с постоянной ссылкой: вызывает свежую версию функции, а сам не меняется от отрисовки к
 * отрисовке. Нужен карточкам сеток (React.memo): обработчик щелчка зависит от адреса страницы и менялся с
 * каждым открытием панели — и все сто карточек рисовались заново ради двух, у которых сменилась отметка
 * (18 ноября 2026). Свежая версия записывается после отрисовки, а не во время неё — как требует React.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
