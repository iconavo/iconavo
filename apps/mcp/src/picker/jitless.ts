// Без eval в рамке клиента (ADR-0045): zod внутри SDK MCP Apps пробует, можно ли строить проверки через
// Function, — строгая политика рамки пишет на это нарушение. SDK отключает пробу в конструкторе App,
// но позже, чем zod успевает её сделать. Настройку zod берёт из globalThis.__zod_globalConfig при своей
// загрузке, поэтому этот модуль импортируется в виде первым.

const g = globalThis as { __zod_globalConfig?: Record<string, unknown> };
g.__zod_globalConfig = { ...(g.__zod_globalConfig ?? {}), jitless: true };
