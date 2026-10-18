# «Вредные» SVG для санитайзера

Проверочные файлы для шага 3 фазы 1 (ADR-0013). Каждый файл воспроизводит один класс атак или мусора из редакторов. Нагрузка безобидная: `alert(1)` и адреса `evil.example`. Первый комментарий в файле — его название в отчёте `pnpm sanitize`.

Ожидаемый итог закреплён в тестах `packages/pipeline/src/sanitize/sanitize.test.ts`.

| № | Файл | Что внутри | Итог |
|---|---|---|---|
| 01 | `01-script.svg` | `<script>` обычный, в CDATA, `<SCRIPT>`, `<s:script>` под чужой приставкой, внешний | очищена: 5 скриптов |
| 02 | `02-event-handlers.svg` | `onload`, `onclick`, `ONCLICK`, `onBegin`, `onmouseover` | очищена: 5 обработчиков |
| 03 | `03-javascript-urls.svg` | `href="javascript:…"`, `&#106;avascript:`, `java&#9;script:`, `data:` в градиенте | очищена; ссылка на `#dot` осталась |
| 04 | `04-external-resources.svg` | `<?xml-stylesheet?>`, `xml:base`, `use` на чужой адрес, внешние `url()` | очищена; локальный `url(#g)` остался |
| 05 | `05-raster-images.svg` | `<image>` (пиксель слежки, `data:`), `<feImage>` | очищена: 3 картинки |
| 06 | `06-html-in-svg.svg` | `foreignObject` с iframe и `<img onerror>`, элементы и `script` из XHTML | очищена |
| 07 | `07-html-breakout.svg` | CDATA в `desc`, комментарий `<!-->…-->`, текст в `<g>`, `fill='red" onload="…'` | очищена; ничего из этого в результате |
| 08 | `08-illustrator-export.svg` | `<?xml?>`, DOCTYPE PUBLIC, служебные атрибуты, классы `.st0` в `<style>` | очищена; стили стали атрибутами |
| 09 | `09-inkscape-export.svg` | `sodipodi:namedview`, RDF, `inkscape:*`, `style` с `-inkscape-*`, `data-name`, `aria-label` | очищена; стили стали атрибутами |
| 10 | `10-xxe.svg` | `<!ENTITY xxe SYSTEM "file:///etc/passwd">` | исключена: DTD с объявлениями |
| 11 | `11-billion-laughs.svg` | вложенные сущности lol…lol9 | исключена мгновенно: DTD с объявлениями |
| 12 | `12-css-import.svg` | `@import url(…)` в `<style>` | исключена: неподдерживаемый CSS |
| 13 | `13-smil-href.svg` | `<set attributeName="href" to="javascript:…">` | исключена: анимация |
| 14 | `14-use-bomb.svg` | 10 уровней по 10 `<use>` — миллиард фигур | исключена: лимит раскрытия `<use>` |
| 15 | `15-unknown-element.svg` | `<handler ev:event="load">` из SVG Tiny | исключена: неизвестный элемент |
