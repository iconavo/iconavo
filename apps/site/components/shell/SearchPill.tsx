"use client";

import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { handOff } from "../../lib/search-handoff";
import { PageLink } from "../PageLink";

/**
 * «Поиск» верхней полосы: ведёт на /search, и там фокус сразу в большом поле — через ту же передачу, что
 * и у Ctrl K (lib/search-handoff): человек нажал «Поиск», чтобы искать (17 ноября 2026).
 */
export function SearchPill({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <PageLink
      lang={lang}
      path="/search"
      className="pill topbar-wide"
      onClick={() => handOff("")}
    >
      <Icon icon="material-symbols:search" className="pill-chevron" />
      <span>{t.topSearch}</span>
    </PageLink>
  );
}
