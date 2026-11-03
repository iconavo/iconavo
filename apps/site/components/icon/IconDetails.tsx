"use client";

import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";
import { track } from "../../lib/analytics";
import type { Applies } from "../../lib/code";
import { DICTIONARIES, href, type Lang, STYLE_KEYS } from "../../lib/i18n";
import {
  attributionText,
  bareName,
  type IconDetails as Details,
  iconPagePath,
} from "../../lib/icon";
import {
  hasSettings,
  iconProps,
  readSettings,
  settingsParams,
  settingsStore,
  useIconSettings,
} from "../../lib/icon-settings";
import { queryText, useUrlQuery } from "../../lib/url-query";
// Хосты иконок — для ядра браузера: варианты и похожие грузит оно само (lib/iconavo.ts).
import "../../lib/iconavo";
import { CopyButton } from "../CopyButton";
import { PageLink } from "../PageLink";
import { Button, buttonClass } from "../ui/button";
import { IconCode } from "./IconCode";
import { IconExport } from "./IconExport";
import { IconSettings } from "./IconSettings";
import type { DetailsState } from "./useIconDetails";

const TONE_KEYS = [
  "iconToneDefault",
  "iconToneLight",
  "iconToneMediumLight",
  "iconToneMedium",
  "iconToneMediumDark",
  "iconToneDark",
] as const;

/** Адрес страницы иконки с настройками вкладки: так они переходят на страницу (решение владельца). */
export function iconPageHref(
  lang: Lang,
  name: string,
  params: URLSearchParams,
): string {
  const query = queryText(params);
  return `${href(lang, iconPagePath(name))}${query === "" ? "" : `?${query}`}`;
}

/**
 * Всё об иконке (шаг 4 фазы 4, ADR-0041): превью на светлом и тёмном фоне, стили и варианты, оттенки,
 * настройки, код и скачивание (шаг 5, ADR-0042), автор и лицензия с текстом указания авторства,
 * описание и похожие. Одно на боковую панель и страницу иконки: в панели варианты и похожие
 * открываются там же (onPick), на странице — ссылки на их страницы, без предзагрузки: каждая видимая
 * ссылка иначе собирала бы страницу.
 */
export function IconDetails({
  lang,
  icon,
  details,
  state,
  onRetry,
  mode,
  onPick,
}: {
  lang: Lang;
  /** Показанное имя: до ответа API — то, что щёлкнули. */
  icon: string;
  details: Details | undefined;
  state: DetailsState;
  onRetry?: () => void;
  mode: "panel" | "page";
  onPick?: (name: string) => void;
}) {
  const t = DICTIONARIES[lang];
  const s = useIconSettings();
  const params = settingsParams(s);
  const paramsText = queryText(params);
  // Разделы — под заголовком панели (h2) или страницы (h1).
  const H = mode === "page" ? "h2" : "h3";

  // Страница: настройки из адреса — один раз после гидратации, дальше настройки — в адрес заменой,
  // чтобы ссылкой можно было поделиться (решение владельца 2 ноября 2026).
  const { query, ready, navigate } = useUrlQuery();
  const applied = useRef(false);
  useEffect(() => {
    if (mode !== "page" || !ready) return;
    if (!applied.current) {
      applied.current = true;
      if (hasSettings(query)) {
        settingsStore.set(readSettings(query));
        return;
      }
    }
    if (paramsText !== queryText(query)) {
      navigate(new URLSearchParams(paramsText), { replace: true });
    }
  }, [mode, ready, query, paramsText, navigate]);
  const shown = details?.icon ?? icon;
  const props = iconProps(s, {
    palette: details?.set.palette ?? false,
    strokes: details?.strokes ?? true,
  });
  // Код и файлы — только с тем, что применимо к иконке; до ответа API — без цвета и толщины.
  const applies: Applies = {
    palette: details?.set.palette ?? false,
    strokes: details?.strokes ?? false,
  };

  /** Ссылка или кнопка другой иконки — по месту. */
  const pick = (
    name: string,
    content: ReactNode,
    className: string,
    current: boolean,
    label?: string,
  ) =>
    mode === "page" ? (
      <Link
        href={iconPageHref(lang, name, params)}
        prefetch={false}
        className={className}
        data-icon={name}
        {...(current ? { "aria-current": "page" as const } : {})}
        {...(label === undefined ? {} : { "aria-label": label })}
      >
        {content}
      </Link>
    ) : (
      <button
        type="button"
        className={className}
        data-icon={name}
        aria-pressed={current}
        onClick={() => onPick?.(name)}
        {...(label === undefined ? {} : { "aria-label": label })}
      >
        {content}
      </button>
    );

  return (
    <div className="icon-details" data-details={state}>
      {details?.hidden ? (
        <p className="icon-hidden">
          <strong>{t.iconHidden}.</strong> {t.iconHiddenNote}
        </p>
      ) : null}
      {details?.alias ? (
        <p className="icon-alias">
          {t.iconAlias.replace("{alias}", details.alias)}
        </p>
      ) : null}

      <div className="icon-preview-pair">
        <figure className="icon-preview preview-light">
          <Icon icon={shown} {...props} />
          <figcaption className="sr-only">{t.iconPreviewLight}</figcaption>
        </figure>
        <figure className="icon-preview preview-dark">
          <Icon icon={shown} {...props} />
          <figcaption className="sr-only">{t.iconPreviewDark}</figcaption>
        </figure>
      </div>
      <p className="icon-name-row">
        <code>{shown}</code>
        <CopyButton
          text={shown}
          labels={{ copy: t.iconCopy, copied: t.iconCopied }}
          label={t.iconCopyName}
          onCopied={() => track({ name: "copy", what: "name", icon: shown })}
        />
      </p>

      {state === "failed" ? (
        <p className="icon-failed" role="alert">
          {t.iconFailed}{" "}
          <Button variant="outline" onClick={onRetry}>
            {t.iconRetry}
          </Button>
        </p>
      ) : null}
      {state === "loading" ? (
        <p className="icon-loading" aria-live="polite">
          <span className="sr-only">{t.iconLoading}</span>
          <span className="icon-skeleton" aria-hidden="true" />
          <span className="icon-skeleton" aria-hidden="true" />
          <span className="icon-skeleton" aria-hidden="true" />
        </p>
      ) : null}

      {/* Один вариант — блок не нужен: выбирать не из чего (решение владельца 3 ноября 2026). */}
      {details !== undefined &&
      details.variants.reduce((n, group) => n + group.icons.length, 0) > 1 ? (
        <section className="icon-section">
          <H className="icon-section-title">{t.iconVariants}</H>
          {details.variants.map((group) => (
            <div key={group.style} className="icon-variants">
              <span className="icon-variants-style">
                {t[STYLE_KEYS[group.style]]}
              </span>
              <span className="icon-variants-list">
                {group.icons.map((name) =>
                  pick(
                    name,
                    <>
                      <Icon icon={name} className="icon-variant-svg" />
                      <span className="icon-variant-name">
                        {bareName(name)}
                      </span>
                    </>,
                    "icon-variant",
                    name === shown,
                  ),
                )}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {details !== undefined &&
      details.card !== null &&
      details.tones.length > 0 ? (
        <section className="icon-section">
          <H className="icon-section-title">{t.iconTones}</H>
          <span className="icon-variants-list">
            {[details.card, ...details.tones].map((name, i) =>
              pick(
                name,
                <Icon icon={name} className="icon-variant-svg" />,
                "icon-variant",
                name === shown,
                t[TONE_KEYS[i] ?? "iconToneDefault"],
              ),
            )}
          </span>
        </section>
      ) : null}

      <IconSettings
        lang={lang}
        palette={details?.set.palette ?? false}
        strokes={details?.strokes ?? false}
      />
      <IconCode lang={lang} name={shown} applies={applies} H={H} />
      <IconExport
        lang={lang}
        name={shown}
        details={details}
        applies={applies}
        H={H}
      />

      {details !== undefined ? (
        <section className="icon-section">
          <dl className="icon-facts">
            <dt>{t.newsSet}</dt>
            <dd>
              <PageLink lang={lang} path={`/${details.set.prefix}`}>
                {details.set.name}
              </PageLink>
            </dd>
            <dt>{t.setAuthor}</dt>
            <dd>
              {details.set.author.url ? (
                <a href={details.set.author.url}>{details.set.author.name}</a>
              ) : (
                details.set.author.name
              )}
            </dd>
            <dt>{t.setLicense}</dt>
            <dd>
              <PageLink lang={lang} path={`/licenses#${details.set.prefix}`}>
                {details.set.license.title}
              </PageLink>
              {(details.credits ?? []).map((c) => (
                <span key={c.name} className="icon-credit">
                  {t.iconBasedOn
                    .replace("{name}", c.name)
                    .replace("{author}", c.author)
                    .replace("{license}", c.license)}
                </span>
              ))}
            </dd>
          </dl>
          {/*
           * Указание авторства — одно на весь набор и по-английски, свёрнуто под стрелкой (решение владельца
           * 3 ноября 2026): родной <details>, с клавиатурой и экранным диктором работает сам.
           */}
          <details className="icon-attribution">
            <summary>{t.iconAttribution}</summary>
            <p className="icon-attribution-text" lang="en">
              {attributionText(details)}
            </p>
            <CopyButton
              text={attributionText(details)}
              labels={{ copy: t.iconCopy, copied: t.iconCopied }}
              onCopied={() =>
                track({ name: "copy", what: "attribution", icon: shown })
              }
            />
            <p className="icon-setting-note">{t.iconAttributionNote}</p>
          </details>
        </section>
      ) : null}

      {/* Описание — только на странице иконки; тегов и синонимов нет (решение владельца 3 ноября 2026). */}
      {mode === "page" && details?.description ? (
        <section className="icon-section">
          <H className="icon-section-title">{t.iconDescription}</H>
          <p>{details.description[lang]}</p>
        </section>
      ) : null}

      {details !== undefined && details.similar.length > 0 ? (
        <section className="icon-section">
          <H className="icon-section-title">{t.iconSimilar}</H>
          <span className="icon-similar">
            {details.similar.map((name) =>
              pick(
                name,
                <>
                  <Icon icon={name} className="icon-variant-svg" />
                  <span className="icon-variant-name">{bareName(name)}</span>
                  <span className="icon-variant-set">
                    {name.slice(0, name.indexOf(":"))}
                  </span>
                </>,
                "icon-variant",
                false,
              ),
            )}
          </span>
        </section>
      ) : null}

      {mode === "panel" ? (
        <p className="icon-open-page">
          <Link
            href={iconPageHref(lang, shown, params)}
            prefetch={false}
            className={buttonClass("primary")}
          >
            {t.panelOpenPage}
            <Icon icon="lucide:arrow-up-right" className="inline-block" />
          </Link>
        </p>
      ) : null}
    </div>
  );
}
