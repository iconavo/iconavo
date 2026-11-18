"use client";

import { type IconavoIconSet, IconavoProvider } from "@iconavo-ui/react";
import type { ReactNode } from "react";
import { PageIconSets } from "./icon/useIconData";

/**
 * Иконки страницы из серверного HTML: IconavoProvider — для самих иконок (без мигания, ADR-0033), и те же
 * данные — панели иконки (useIconData): код и толщина линии в ней рисуются сразу, без запроса к edge API.
 * Данные приходят в браузер один раз.
 */
export function PageIcons({
  icons,
  children,
}: {
  icons: IconavoIconSet[];
  children: ReactNode;
}) {
  return (
    <IconavoProvider icons={icons}>
      <PageIconSets.Provider value={icons}>{children}</PageIconSets.Provider>
    </IconavoProvider>
  );
}
