// Рисовальщик resvg готовится при запуске функции, а не в вызове инструмента (замер 19 ноября 2026:
// около 14 мс процессора на копию). Модуль wasm Workers компилирует при выкладке: он приходит
// отдельной частью загрузки (application/wasm), и импорт отдаёт готовый WebAssembly.Module —
// компилировать wasm из байтов во время работы Workers запрещает. Тесты этот файл не импортируют.

import { initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "./resvg.wasm";

await initWasm(resvgWasm);
