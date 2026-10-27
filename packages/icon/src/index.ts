// Пакет @iconavo-ui/icon (ADR-0029, ADR-0032): импорт регистрирует тег <iconavo-icon>, функции и типы —
// из ядра, ровно те, что описаны в README. Это вход обычной сборки: режим разработки по умолчанию
// выключен. Сборка для разработки берёт development.js (условие экспорта development), страница без
// сборщика — script.js (ADR-0031, ADR-0034).

import { define } from "./element.js";

export * from "@iconavo-ui/core";

define(false);
