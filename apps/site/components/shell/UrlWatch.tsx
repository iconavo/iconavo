"use client";

// Переход по ссылке на эту же страницу (путь тот же, параметры другие: «Lucide» в левой панели, когда
// открыта третья страница набора) не меняет путь, и useUrlQuery о нём не узнал бы — сетка осталась бы со
// старыми фильтрами (ревизия фазы 5, С-1). Next.js сообщает о любом переходе через useSearchParams, и
// этот компонент передаёт его остальным событием URL_EVENT. useSearchParams — только здесь, под своим
// Suspense (Shell.tsx): остальная страница остаётся статической, а сам он в серверном HTML пустой.

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { URL_EVENT } from "../../lib/url-query";

export function UrlWatch() {
  const search = useSearchParams().toString();
  useEffect(() => {
    void search;
    window.dispatchEvent(new Event(URL_EVENT));
  }, [search]);
  return null;
}
