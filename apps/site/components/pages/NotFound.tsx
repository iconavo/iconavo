// Страница 404 — одна на оба языка: её отдаёт app/global-not-found.tsx на любой несуществующий адрес,
// и язык адреса она не знает (ADR-0037). Ссылки — обычные <a>: главные — в разных корневых раскладках.
export function NotFound() {
  return (
    <main id="content" className="container home">
      <h1>Page not found</h1>
      <p>
        There is no page at this address. <a href="/">Go home</a> or{" "}
        <a href="/docs">read the docs</a>.
      </p>
      <p lang="ru">
        Страница не найдена: по этому адресу ничего нет.{" "}
        <a href="/ru" hrefLang="ru">
          На главную
        </a>
        .
      </p>
    </main>
  );
}
