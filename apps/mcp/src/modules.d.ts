// Строки установки и разделы README тега — вшиты при сборке (pnpm mcp build, модуль без файла).
declare module "virtual:iconavo/readme" {
  const usage: import("@iconavo-ui/snippets/readme").Usage;
  export default usage;
}

// Страница сетки выбора pick_icon (ADR-0045) — собрана и вшита при сборке (pnpm mcp build).
declare module "virtual:iconavo/picker" {
  const picker: import("./context.js").PickerPage;
  export default picker;
}

// Модуль wasm в Workers — готовый WebAssembly.Module (часть загрузки application/wasm, pnpm mcp build).
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
