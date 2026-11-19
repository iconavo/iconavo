// Модуль wasm в Workers — готовый WebAssembly.Module (часть загрузки application/wasm, pnpm mcp build).
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
