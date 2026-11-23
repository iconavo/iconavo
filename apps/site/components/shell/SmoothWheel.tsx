"use client";

import { useEffect } from "react";
import { smoothWheel } from "../../lib/smooth-wheel";

/**
 * Плавное колесо мыши на всём сайте (lib/smooth-wheel.ts, решение владельца 23 ноября 2026): после щелчка
 * колеса страница мягко доезжает до места. Ничего не рисует.
 */
export function SmoothWheel() {
  useEffect(() => smoothWheel(window), []);
  return null;
}
