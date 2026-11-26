"use client";

// Просмотр раздела сайта — событие аналитики (шаг 2 фазы 5, ADR-0043): при загрузке и при каждом
// переходе на другой путь; только раздел и язык, без адреса и параметров (решение владельца 26 ноября
// 2026). Стоит в каркасе до содержимого страницы: страница иконки по счёту просмотров узнаёт, открыта
// ли она прямой ссылкой.

import { useEffect } from "react";
import { pageViewed, sectionOf } from "../../lib/analytics";
import { usePagePath } from "../../lib/page-path";

export function PageView() {
  const path = usePagePath();
  useEffect(() => {
    pageViewed(sectionOf(path));
  }, [path]);
  return null;
}
