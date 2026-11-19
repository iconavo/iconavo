// SVG → PNG рисовальщиком resvg (тот же, что у контроля качества, ADR-0016) и PNG → base64 для
// ответа инструмента. В Workers модуль wasm готовит wasm.ts при запуске функции; тесты готовят его
// сами из node_modules.

import { Resvg } from "@resvg/resvg-wasm";

export type PngRenderer = (svg: string) => Uint8Array;

/** Картинка без шрифтов: в сетке их нет, цифры номеров — контуры (digits.ts). */
export const renderPng: PngRenderer = (svg) => {
  const resvg = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
};

/** base64 кусками: String.fromCharCode с сотней тысяч аргументов переполнил бы стек. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
