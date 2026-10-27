// Стили тега (ADR-0032, ADR-0031): один лист на все теги страницы через adoptedStyleSheets — строгая
// CSP его не запрещает, в отличие от <style> в каждом теге.
// - :host — строчный блок размером с то, что внутри: резерв или иконку. Атрибут hidden прячет тег
//   сам: правило :host главнее правила браузера [hidden].
// - inline опускает иконку на 0,125em, на линию текста, как у Iconify, — без перерисовки.
// - Заглушки рисуются на самом резерве — пустом <svg>, поэтому растут вместе с ним: скелетон —
//   скруглённый квадрат цвета текста, спиннер — дуга по кругу (градиент и маска). Первые 150 мс
//   заглушку прячет анимация h: step-end держит visibility: hidden до её конца, а если анимация не
//   сработала, заглушка просто видна сразу. Без движения (prefers-reduced-motion) нет мерцания и
//   вращения, задержка остаётся.
// - Рамка отсутствующей иконки — в режиме разработки; её CSS есть во всех сборках, иначе
//   configure({ dev: true }) не работал бы.

export const CSS =
  ":host{display:inline-block}:host([hidden]){display:none}" +
  ":host([inline]){vertical-align:-.125em}svg{display:block}" +
  ".skeleton{border-radius:15%;background:currentColor;opacity:.12;" +
  "animation:h .15s step-end,p 1s .15s infinite alternate}" +
  ".spinner{border-radius:50%;background:conic-gradient(#0000 20%,currentColor);" +
  "mask:radial-gradient(closest-side,#0000 64%,#000 66%);" +
  "animation:h .15s step-end,s 1s .15s linear infinite}" +
  ".missing{outline:1px dashed}" +
  "@keyframes h{from{visibility:hidden}}@keyframes p{to{opacity:.24}}" +
  "@keyframes s{to{transform:rotate(1turn)}}" +
  "@media(prefers-reduced-motion:reduce){.skeleton,.spinner{animation:h .15s step-end}}";
