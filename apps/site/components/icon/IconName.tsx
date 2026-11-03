"use client";

import { Icon } from "@iconavo-ui/react";
import { track } from "../../lib/analytics";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { formatName, NAME_FORMATS, type NameFormat } from "../../lib/names";
import { nameStore, useChoice } from "../../lib/prefs";
import { CopyButton } from "../CopyButton";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * Имя иконки и его формат (шаг 5 фазы 4; решения владельца 3 ноября 2026) — как у Iconify: список
 * форматов и отдельная кнопка «Копировать имя». По умолчанию — набор/иконка (lucide/house), выбор
 * запоминается (lib/prefs.ts). Меню — DropdownMenu Radix, немодальное, как меню темы (ADR-0038).
 */
export function IconName({ lang, name }: { lang: Lang; name: string }) {
  const t = DICTIONARIES[lang];
  const format = useChoice(nameStore);
  const shown = formatName(name, format);
  const labels: Record<NameFormat, string> = {
    path: t.namePath,
    iconify: t.nameIconify,
    component: t.nameComponent,
    tailwind: "Tailwind CSS",
    unocss: "UnoCSS",
    unocssDash: "UnoCSS",
    bare: t.nameBare,
    cssClass: t.nameCssClass,
  };
  return (
    <p className="icon-name-row">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="name-format"
            aria-label={`${t.iconNameFormat}: ${shown}`}
          >
            <code className="name-format-text">{shown}</code>
            <Icon icon="lucide:chevron-down" className="inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={format}
            onValueChange={(value) => nameStore.set(value as NameFormat)}
          >
            {NAME_FORMATS.map((f) => (
              <DropdownMenuRadioItem key={f} value={f}>
                <code>{formatName(name, f)}</code>
                <span className="name-format-label">{labels[f]}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CopyButton
        text={shown}
        labels={{ copy: t.iconCopy, copied: t.iconCopied }}
        label={t.iconCopyName}
        onCopied={() =>
          track({ name: "copy", what: "name", icon: name, format })
        }
      />
    </p>
  );
}
