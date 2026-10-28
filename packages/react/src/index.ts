// Пакет @iconavo-ui/react (ADR-0029, ADR-0033): компонент Icon и обёртка IconavoProvider; функции и
// типы — из ядра, ровно те, что описаны в README. У входа нет "use client": loadIcons вызывают и в
// серверном компоненте, а пометки стоят у модулей компонентов (icon.ts, provider.ts).

export * from "@iconavo-ui/core";
export { Icon } from "./icon.js";
export { IconavoProvider } from "./provider.js";
