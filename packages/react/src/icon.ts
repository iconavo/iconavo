"use client";
// Компонент Icon (ADR-0033, ADR-0031): иконка по имени — всегда один <svg>, и пока она грузится, тоже.
// Рисует ядро (renderIcon), состояние читается из хранилища ядра через useSyncExternalStore.
// - Главное правило: на сервере и при гидратации разметка зависит только от пропсов, данных обёртки и
//   чистых функций ядра (state.ts). Хранилище, configure(), режим разработки и CSS.supports читаются
//   только в браузере — в листе стилей и в эффектах.
// - Запрос — в эффекте, при монтировании и смене имени, если иконки нет в обёртке; на сервере эффектов
//   нет. Эффект — после подписки useSyncExternalStore: повторы ядра идут, пока у имени есть слушатель
//   (ADR-0030). «Ошибка» запрашивается снова при следующем монтировании, как у тега «при следующем
//   показе».
// - ID внутри рисунка — от useId: одинаковые на сервере и в браузере, свои у каждой копии (ADR-0031).
// - Атрибута style компонент не ставит (строгая CSP): цвет — атрибутом color, inline и заглушки —
//   классами листа стилей (style.ts). Свои пропсы разработчика идут на <svg> последними.

import {
  isValidIconName,
  loadIcon,
  renderIcon,
  store,
  subscribeIcon,
  warn,
} from "@iconavo-ui/core/internal";
import {
  createElement,
  forwardRef,
  type SVGProps,
  useCallback,
  useContext,
  useEffect,
  useId,
  useInsertionEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { type IconOptions, iconOptions } from "./options.js";
import { Icons, lookup } from "./provider.js";
import { clientState, serverState } from "./state.js";
import { adopt, css } from "./style.js";
import { trusted } from "./trusted.js";

/** Пропсы Icon: свои и атрибуты <svg>, кроме содержимого. */
export type IconProps = IconOptions &
  Omit<
    SVGProps<SVGSVGElement>,
    keyof IconOptions | "ref" | "children" | "dangerouslySetInnerHTML"
  >;

/** Режим разработки по умолчанию — как в самом React; без сборщика process нет — выключен. */
const DEV = (() => {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
})();

/**
 * An icon by its name, `set:icon`. Always renders an `<svg>`, also while the icon loads; other props
 * such as `className`, `style`, event handlers and `ref` go to it.
 */
export const Icon = forwardRef<SVGSVGElement, IconProps>(
  function Icon(props, ref) {
    const {
      icon,
      width,
      height,
      color,
      strokeWidth,
      rotate,
      flip,
      inline,
      label,
      placeholder,
      className,
      ...rest
    } = props;
    const scope = useContext(Icons);
    const provided = isValidIconName(icon) ? lookup(scope, icon) : undefined;
    const state = useSyncExternalStore(
      useCallback(
        (listener: () => void) => subscribeIcon(icon, listener),
        [icon],
      ),
      () => clientState(icon, provided),
      () => serverState(icon, provided),
    );
    useEffect(() => {
      if (icon && typeof provided !== "object") loadIcon(icon);
    }, [icon, provided]);
    const o = useMemo(
      () =>
        iconOptions({ width, height, strokeWidth, rotate, flip, placeholder }),
      [width, height, strokeWidth, rotate, flip, placeholder],
    );
    useEffect(() => {
      for (const text of o.warnings) warn(text);
      if (color && typeof CSS === "object" && !CSS.supports("color", color)) {
        warn(`invalid color "${color}", use a CSS color`);
      }
    }, [o, color]);
    useInsertionEffect(() => {
      adopt(css(store.settings.placeholder, store.settings.dev ?? DEV));
    }, []);
    const id = useId();
    const parts = useMemo(
      () =>
        typeof state === "object"
          ? renderIcon(state, { ...o.render, color, label, idPrefix: id })
          : null,
      [state, o, color, label, id],
    );
    const html = useMemo(() => parts && trusted(parts.body), [parts]);
    // Рисунка нет — резерв: заглушка, пока грузится, иначе «нет» (и запрет Trusted Types).
    const drawn = parts !== null && html !== null;
    const own = [
      inline && "iconavo-inline",
      drawn ? "" : state === "loading" ? o.placeholder : "iconavo-missing",
      className,
    ]
      .filter(Boolean)
      .join(" ");
    const name = label?.trim();
    return createElement("svg", {
      ...(drawn
        ? parts.attributes
        : {
            width: o.width,
            height: o.height,
            color,
            ...(name
              ? { role: "img", "aria-label": name }
              : { "aria-hidden": "true" }),
          }),
      className: own || undefined,
      ...rest,
      ref,
      ...(drawn ? { dangerouslySetInnerHTML: { __html: html as string } } : {}),
    });
  },
);
