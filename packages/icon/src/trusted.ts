// Разметка иконки — через Trusted Types (ADR-0032). Со строгой CSP (require-trusted-types-for
// 'script') shadowRoot.innerHTML принимает только TrustedHTML, а README просит разрешить одну
// политику — trusted-types iconavo.
// - Политика одна на страницу: она лежит под ключом Symbol.for без версии формата, и её находят все
//   копии и версии тега, а с шага 7 и React. Вторая политика с тем же именем без 'allow-duplicates'
//   — исключение.
// - Создаётся при первой нарисованной иконке; отказ запоминается как null, и дальше пишутся строки.
// - createHTML — тождественная функция, навсегда: другая версия может взять тот же объект. Данные
//   наших наборов очищены конвейером (ADR-0013), а свои хосты и загрузчики README просит выбирать как
//   скрипты.
// - Запись, которую браузер всё же запретил, — одно предупреждение вместо исключения на каждую иконку.

import { warn } from "@iconavo-ui/core/internal";

const KEY = Symbol.for("iconavo.trusted-types");

/** Политика Trusted Types — в типах DOM TypeScript её нет. */
interface Policy {
  createHTML(html: string): unknown;
}

interface Shared {
  trustedTypes?: {
    createPolicy(
      name: string,
      rules: { createHTML(html: string): string },
    ): Policy;
  };
  [KEY]?: Policy | null;
}

/** Разметка в shadow DOM; запрет Trusted Types — false и одно предупреждение. */
export function write(root: ShadowRoot, html: string): boolean {
  const shared = globalThis as Shared;
  try {
    if (shared[KEY] === undefined) {
      try {
        shared[KEY] =
          shared.trustedTypes?.createPolicy("iconavo", {
            createHTML: (value) => value,
          }) ?? null;
      } catch {
        shared[KEY] = null;
      }
    }
    const policy = shared[KEY];
    root.innerHTML = (policy ? policy.createHTML(html) : html) as string;
    return true;
  } catch {
    warn('Trusted Types blocked icons, allow "trusted-types iconavo"');
    return false;
  }
}
