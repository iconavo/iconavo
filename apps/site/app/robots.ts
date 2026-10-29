import type { MetadataRoute } from "next";

// Обход разрешён и до запуска: запрет в robots.txt спрятал бы от поисковика саму метку noindex страниц,
// и адрес мог бы попасть в выдачу по внешним ссылкам (lib/headers.ts).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
