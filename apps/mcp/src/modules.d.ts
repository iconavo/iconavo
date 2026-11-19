// Строки установки и разделы README тега — вшиты при сборке (pnpm mcp build, модуль без файла).
declare module "virtual:iconavo/readme" {
  const usage: import("@iconavo-ui/snippets/readme").Usage;
  export default usage;
}

// Модуль wasm в Workers — готовый WebAssembly.Module (часть загрузки application/wasm, pnpm mcp build).
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
