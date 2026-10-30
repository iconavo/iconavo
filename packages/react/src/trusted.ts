// Рисунок иконки для innerHTML — через Trusted Types (ADR-0032, ADR-0033). Политика та же, что у тега:
// iconavo под ключом Symbol.for без версии формата, одна на страницу для всех копий тега и React.
// - React передаёт __html в innerHTML как есть, поэтому TrustedHTML проходит строгую CSP. Сравнивает он
//   __html на равенство, так что объект создаётся один раз на строку рисунка (useMemo в icon.ts).
// - На сервере и в браузере без Trusted Types — строка.
// - Политику не разрешили, а Trusted Types требуются: строка уронила бы всё дерево React, поэтому
//   иконки — пустое место и одно предупреждение, как у тега. Пробная запись — этим же рисунком в
//   отдельный <template>: политика страницы по умолчанию может пропустить пустую строку и не
//   пропустить рисунок.

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

/** Рисунок для __html: TrustedHTML или строка; null — рисовать нельзя, иконка пустая. */
export function trusted(html: string): unknown {
  const shared = globalThis as Shared;
  if (typeof document !== "object" || !shared.trustedTypes) return html;
  if (shared[KEY] === undefined) {
    try {
      shared[KEY] =
        shared.trustedTypes.createPolicy("iconavo", {
          createHTML: (value) => value,
        }) ?? null;
    } catch {
      shared[KEY] = null;
    }
  }
  const policy = shared[KEY];
  if (policy) return policy.createHTML(html);
  try {
    // <template>: разметка не грузит картинок и не запускает ничего.
    document.createElement("template").innerHTML = html;
    return html;
  } catch {
    warn('Trusted Types blocked icons, allow "trusted-types iconavo"');
    return null;
  }
}
