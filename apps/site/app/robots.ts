import type { MetadataRoute } from "next";
import { robotsRules } from "../lib/headers";

// Поисковикам обход разрешён и до запуска: запрет в robots.txt спрятал бы от них саму метку noindex
// страниц, и адрес мог бы попасть в выдачу по внешним ссылкам (lib/headers.ts). ИИ-обходчикам до
// запуска обход закрыт — AI_CRAWLERS (ADR-0039).
export default function robots(): MetadataRoute.Robots {
  return { rules: robotsRules() };
}
