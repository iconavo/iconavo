"use client";

// Сведения об иконке из адреса /icon edge API (шаг 4 фазы 4) — для панели. Память вкладки: щёлкнуть
// туда-обратно — без новых запросов. Быстрая смена иконки отменяет прежний запрос; сбой — «Повторить».

import { useEffect, useState } from "react";
import { API } from "../../lib/api";
import {
  type IconDetails,
  iconDetailsUrl,
  parseIconDetails,
} from "../../lib/icon";

const MEMORY_LIMIT = 100;
const memory = new Map<string, IconDetails>();

function remember(name: string, details: IconDetails) {
  memory.delete(name);
  memory.set(name, details);
  if (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

export type DetailsState = "loading" | "ready" | "failed";

export function useIconDetails(name: string): {
  details?: IconDetails;
  state: DetailsState;
  retry: () => void;
} {
  const [view, setView] = useState<{
    name: string;
    details?: IconDetails;
    state: DetailsState;
  }>(() => ({ name, state: "loading" }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    const kept = memory.get(name);
    if (kept !== undefined) {
      setView({ name, details: kept, state: "ready" });
      return;
    }
    setView({ name, state: "loading" });
    const controller = new AbortController();
    fetch(iconDetailsUrl(API, name), { signal: controller.signal })
      .then(async (res) => {
        const details = res.ok ? parseIconDetails(await res.json()) : undefined;
        if (controller.signal.aborted) return;
        if (details === undefined) {
          setView({ name, state: "failed" });
          return;
        }
        remember(name, details);
        setView({ name, details, state: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setView({ name, state: "failed" });
      });
    return () => controller.abort();
  }, [name, attempt]);

  const current =
    view.name === name ? view : { name, state: "loading" as const };
  return {
    ...(current.details === undefined ? {} : { details: current.details }),
    state: current.state,
    retry: () => setAttempt((n) => n + 1),
  };
}
