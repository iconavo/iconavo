// Вход скрипта для страниц без сборщика (ADR-0032): из него rolldown собирает dist/iconavo-icon.js —
// один модуль с ядром внутри, который подключают с jsDelivr. Режим разработки по умолчанию — на
// страницах с localhost, 127.0.0.1, [::1] и file: (ADR-0031).

import { define } from "./element.js";

export * from "@iconavo-ui/core";

define(typeof location === "object" &&
  (location.protocol === "file:" ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)));
