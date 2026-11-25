"use client";

import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { track } from "../../lib/analytics";
import { copyText } from "../../lib/clipboard";
import type { Applies } from "../../lib/code";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import {
  bareName,
  type IconDetails,
  type IconSetSummary,
  iconPagePath,
} from "../../lib/icon";
import {
  type IconPageData,
  TAGS_SHOWN,
  withBrowserDetails,
} from "../../lib/icon-page";
import {
  hasSettings,
  readSettings,
  settingsParams,
  settingsStore,
  useIconSettings,
} from "../../lib/icon-settings";
import { mockupLabel } from "../../lib/mockups";
import { panelSettings } from "../../lib/panel-code";
import { queryText, useUrlQuery } from "../../lib/url-query";
import { Crumbs } from "../Crumbs";
import { type DetailsState, useIconDetails } from "../icon/useIconDetails";
import { PageLink } from "../PageLink";
import {
  PanelColor,
  PanelName,
  PanelSize,
  PanelStroke,
} from "../panel/controls";
import { PanelCode } from "../panel/PanelCode";
import { PanelCredits } from "../panel/PanelCredits";
import { useCopied } from "../panel/parts";
import {
  BagAction,
  CopyAction,
  DownloadAction,
  RemovedActions,
} from "./Actions";
import { IconSkeleton } from "./IconSkeleton";
import { InContext } from "./InContext";
import { PreviewSizes, PreviewTile } from "./Preview";
import { Similar } from "./Similar";

type Tab = "similar" | "code" | "context";

/** Кнопка-ссылка у имени: копирует адрес страницы без настроек (гайд макета). */
function CopyLink({ lang, icon }: { lang: Lang; icon: string }) {
  const t = DICTIONARIES[lang];
  const [copied, done] = useCopied();
  return (
    <button
      type="button"
      className="ip-link"
      aria-label={copied ? t.ipLinkCopied : t.ipCopyLink}
      onClick={async () => {
        try {
          await copyText(`${location.origin}${location.pathname}`);
        } catch {
          return;
        }
        done();
        track({ name: "copy", what: "page-link", icon });
      }}
    >
      <Icon
        icon={copied ? "material-symbols:check" : "material-symbols:link-2"}
      />
    </button>
  );
}

/** Строка «подпись: значение» мета-строки и строки дат. */
function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <span className="ip-meta-label">{label}</span>
      <span className="ip-meta-value">{children}</span>
    </li>
  );
}

/** Теги из /icon: восемь и «+N» (макет); пока грузятся — полоса скелетона, поиск не ответил — блока нет. */
function Tags({
  lang,
  details,
  state,
}: {
  lang: Lang;
  details: IconDetails | undefined;
  state: DetailsState;
}) {
  const t = DICTIONARIES[lang];
  const [all, setAll] = useState(false);
  if (state === "failed") return null;
  if (details !== undefined && details.tags.length === 0) return null;
  const tags = details?.tags ?? [];
  const shown = all ? tags : tags.slice(0, TAGS_SHOWN);
  const more = tags.length - shown.length;
  return (
    <section className="ip-block ip-tags" aria-labelledby="ip-tags-label">
      <h2 id="ip-tags-label" className="ip-label">
        {t.ipTags}
      </h2>
      {details === undefined ? (
        <span className="ip-skeleton ip-skeleton-tags" aria-hidden="true" />
      ) : (
        <p className="ip-tag-list">
          <span>{shown.join(" · ")}</span>
          {more > 0 ? (
            <button
              type="button"
              className="ip-more"
              aria-label={`${t.ipTagsMore}: +${more}`}
              onClick={() => setAll(true)}
            >
              +{more}
            </button>
          ) : null}
        </p>
      )}
    </section>
  );
}

/**
 * Страница иконки по макету Figma «Страница иконки» (редизайн, шаг 4): первый экран и вкладки. Данные
 * собирает сервер (components/pages/IconPage.tsx) из каталога наборов; сведения /icon — теги, похожие,
 * подпись и Feather — с сервера, а если поиск тогда не ответил, браузер спрашивает их сам. Настройки
 * Size, Color и Stroke Width — общие с панелью иконки; из адреса — после гидратации, дальше — в адрес
 * заменой, чтобы ссылкой можно было поделиться (решение владельца 2 ноября 2026). Поворотов и отражений на
 * странице нет — как в панели.
 */
export function IconView({ lang, page }: { lang: Lang; page: IconPageData }) {
  const t = DICTIONARIES[lang];
  const stored = useIconSettings();
  const s = panelSettings(stored);
  const applies: Applies = {
    palette: page.set.palette,
    strokes: page.strokes,
  };
  const { details, state, retry } = useIconDetails(page.icon, page.details);
  const [tab, setTab] = useState<Tab>("similar");
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();

  const paramsText = queryText(settingsParams(s));
  const { query, ready, navigate } = useUrlQuery();
  const applied = useRef(false);
  useEffect(() => {
    if (!ready) return;
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
  }, [ready, query, paramsText, navigate]);

  const { prefix, name: setName } = page.set;
  const bare = bareName(page.icon);
  const pageHref = (name: string) =>
    `${href(lang, iconPagePath(name))}${paramsText === "" ? "" : `?${paramsText}`}`;
  const set: IconSetSummary =
    details?.set.credits === undefined
      ? page.set
      : { ...page.set, credits: details.set.credits };
  // Кнопкам — и сведения, пришедшие уже в браузере (ревизия фазы 5, С-6).
  const actionPage = withBrowserDetails(page, details);
  const label =
    details?.synonyms === undefined || details.synonyms === null
      ? page.label
      : mockupLabel(
          { icon: page.icon, card: page.card, synonyms: details.synonyms },
          lang,
        );
  const tabs: [Tab, string][] = page.hidden
    ? [["similar", t.ipTabSimilar]]
    : [
        ["similar", t.ipTabSimilar],
        ["code", t.ipTabCode],
        ["context", t.ipTabContext],
      ];
  const removedNote =
    page.removedIn !== undefined && page.dates.removed !== undefined
      ? t.ipRemovedNote
          .replace("{set}", setName)
          .replace("{version}", page.removedIn)
          .replace("{date}", page.dates.removed)
      : t.ipRemovedNoteShort.replace("{set}", setName);

  /**
   * Переход на страницу другой иконки (плитка стиля, похожая) — в переходе React: пока сервер собирает
   * страницу, вместо неё скелетон (кадр Loading). Щелчок с клавишей или средней кнопкой — как у ссылки.
   */
  function follow(e: MouseEvent<HTMLAnchorElement>) {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const target = e.currentTarget.getAttribute("href");
    if (target === null) return;
    e.preventDefault();
    startNavigation(() => router.push(target));
  }

  /** Стрелки, Home и End переводят фокус и выбор по вкладкам (шаблон ARIA Tabs). */
  function onTabsKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex(([id]) => id === tab);
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    const next = tabs[to];
    if (next === undefined) return;
    e.preventDefault();
    const [id] = next;
    setTab(id);
    document.getElementById(`ip-tab-${id}`)?.focus();
  }

  if (navigating) return <IconSkeleton lang={lang} />;

  return (
    <>
      <Crumbs
        lang={lang}
        items={[
          { path: "/", label: t.navIconSets },
          { path: `/${prefix}`, label: setName },
        ]}
        current={bare}
        className="ip-crumbs"
      />
      <PageLink lang={lang} path={`/${prefix}`} className="set-back ip-back">
        <Icon
          icon="material-symbols:keyboard-arrow-left"
          className="pill-chevron"
        />
        {setName}
      </PageLink>

      <div className="ip-hero" data-removed={page.hidden ? "" : undefined}>
        <div className="ip-head">
          <div className="ip-title-row">
            <h1 className="ip-title">{bare}</h1>
            {page.hidden ? (
              <span className="ip-badge">{t.ipRemovedBadge}</span>
            ) : null}
            <CopyLink lang={lang} icon={page.icon} />
          </div>
          <ul className="ip-meta">
            <Meta label={t.ipFamily}>
              <PageLink
                lang={lang}
                path={`/${prefix}`}
                className="ip-link-text"
              >
                {setName}
              </PageLink>
            </Meta>
            <Meta label={t.ipLicense}>
              <PageLink
                lang={lang}
                path={`/licenses#${prefix}`}
                className="ip-link-text"
              >
                {page.set.license.title}
              </PageLink>
            </Meta>
            <Meta label={t.ipSize}>
              {page.data.width} × {page.data.height} px
            </Meta>
          </ul>
          {page.hidden ? (
            <p className="ip-notice">
              <Icon icon="material-symbols:report" className="ip-notice-icon" />
              <span>
                {removedNote} {t.ipRemovedHint}
              </span>
            </p>
          ) : null}
        </div>

        <div className="ip-visual">
          <PreviewTile lang={lang} page={page} s={s} />
          {page.hidden ? null : <PreviewSizes lang={lang} page={page} s={s} />}
        </div>

        <div className="ip-info">
          <Tags lang={lang} details={details} state={state} />
          {page.categories.length > 0 ? (
            <section
              className="ip-block ip-cats"
              aria-labelledby="ip-cats-label"
            >
              <h2 id="ip-cats-label" className="ip-label">
                {t.ipCategories}
              </h2>
              <ul className="ip-chips">
                {page.categories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={`${href(lang, `/${prefix}`)}?category=${encodeURIComponent(c.slug)}`}
                      className="pill-option"
                    >
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {page.hidden ? (
            <RemovedActions
              lang={lang}
              page={actionPage}
              s={s}
              applies={applies}
            />
          ) : (
            <>
              <div className="ip-pair">
                <PanelSize lang={lang} s={stored} />
                {page.set.palette ? null : (
                  <PanelColor lang={lang} s={stored} />
                )}
              </div>
              <div className="ip-actions">
                <CopyAction
                  lang={lang}
                  page={actionPage}
                  s={s}
                  applies={applies}
                />
                <DownloadAction
                  lang={lang}
                  page={actionPage}
                  s={s}
                  applies={applies}
                />
                <BagAction lang={lang} icon={page.icon} />
              </div>
            </>
          )}
          {page.tiles.items.length > 1 ? (
            <section
              className="ip-block ip-styles"
              aria-labelledby="ip-styles-label"
            >
              <h2 id="ip-styles-label" className="ip-label">
                {page.tiles.kind === "tones" ? t.ipTones : t.ipOtherStyles}
              </h2>
              <ul className="ip-style-row">
                {page.tiles.items.map((tile) => (
                  <li key={tile.name}>
                    <Link
                      href={pageHref(tile.name)}
                      prefetch={false}
                      className="icon-card-link ip-style"
                      data-icon={tile.name}
                      onClick={follow}
                      {...(tile.name === page.icon
                        ? { "aria-current": "page" as const }
                        : {})}
                    >
                      <Icon icon={tile.name} height={24} />
                      <span className="ip-style-label">{tile.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {page.dates.added !== undefined ||
          (page.hidden
            ? page.dates.removed !== undefined
            : page.dates.changed !== undefined) ? (
            <ul className="ip-meta ip-dates">
              {page.dates.added === undefined ? null : (
                <Meta label={t.ipAdded}>{page.dates.added}</Meta>
              )}
              {page.hidden ? (
                page.dates.removed === undefined ? null : (
                  <Meta label={t.ipRemoved}>{page.dates.removed}</Meta>
                )
              ) : page.dates.changed === undefined ? null : (
                <Meta label={t.ipChanged}>{page.dates.changed}</Meta>
              )}
            </ul>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label={t.ipTabs}
        className="ip-tabs"
        onKeyDown={onTabsKey}
      >
        {tabs.map(([id, text]) => (
          <button
            key={id}
            id={`ip-tab-${id}`}
            type="button"
            role="tab"
            className="ip-tab"
            data-label={text}
            aria-selected={tab === id}
            aria-controls="ip-tabpanel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>
      <div
        id="ip-tabpanel"
        role="tabpanel"
        aria-labelledby={`ip-tab-${tab}`}
        className="ip-tabpanel"
        data-tab={tab}
      >
        {tab === "similar" ? (
          <Similar
            lang={lang}
            page={page}
            details={details}
            state={state}
            onRetry={retry}
            query={paramsText}
            onFollow={follow}
          />
        ) : tab === "code" ? (
          <>
            <p className="ip-lead">{t.ipCodeLead}</p>
            <div className="ip-code-fields">
              <PanelName lang={lang} name={page.icon} />
              {page.strokes ? <PanelStroke lang={lang} s={stored} /> : null}
            </div>
            <div className="ip-code-card">
              <PanelCode
                lang={lang}
                name={page.icon}
                icon={page.data}
                s={stored}
                applies={applies}
              />
            </div>
            <PanelCredits lang={lang} name={page.icon} set={set} />
          </>
        ) : (
          <>
            <p className="ip-lead">{t.ipContextLead.replace("{name}", bare)}</p>
            <InContext
              lang={lang}
              icon={page.icon}
              label={label}
              neighbours={page.neighbours}
              {...(page.strokes && s.stroke !== undefined
                ? { strokeWidth: s.stroke }
                : {})}
            />
          </>
        )}
      </div>
    </>
  );
}
