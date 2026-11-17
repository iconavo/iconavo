"use client";

import { Icon } from "@iconavo-ui/react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { usePagePath } from "../../lib/page-path";
import { QUERY_MAX_LENGTH, TYPING_PAUSE_MS } from "../../lib/search";
import { takeHandoff } from "../../lib/search-handoff";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Crumbs } from "../Crumbs";
import { AiSearch, GridSettings, ViewSwitch } from "../catalog/GridToolbar";
import { PageLink } from "../PageLink";
import { SEARCH_INPUT_ID } from "../shell/HotKey";
import { FilterButton } from "./FilterSheet";

/**
 * Большое поле поиска главной и страницы поиска (шаг 3 фазы 4, ADR-0040). Оно в общей раскладке
 * app/(…)/(find): при переходе с главной на /search раскладка не пересоздаётся, поэтому поле, фокус и
 * набранные буквы остаются на месте (решение владельца: поле ищет по мере ввода). Без JavaScript —
 * обычная форма на /search.
 * - Пауза 150 мс — запрос: на главной — переход на /search?q=…, на /search — смена адреса.
 * - Первая пауза набора добавляет запись в историю, следующие её заменяют: «назад» возвращает прежний
 *   запрос, а не каждую букву. Enter, уход из поля и переход по ссылке начинают новый набор.
 * - Пока идёт ввод иероглифов или диакритики (IME), запрос не уходит.
 * - Текст из поля шапки (lib/search-handoff) подхватывается вместе с фокусом.
 * - На /search вокруг поля — шапка и строка инструментов по макету «Сценарий поиска иконок» (редизайн,
 *   17 ноября 2026): как у страницы набора, на телефоне — ещё кнопка фильтра (FilterSheet).
 */
export function SearchHero({
  lang,
  intro,
}: {
  lang: Lang;
  /** Начало главной по макету (HomeIntro): заголовок, подзаголовок, ссылки — только на главной. */
  intro?: ReactNode;
}) {
  const t = DICTIONARIES[lang];
  const router = useRouter();
  const pathname = usePagePath();
  const searchPath = href(lang, "/search");
  const onSearch = pathname === searchPath;
  const { query, ready, navigate } = useUrlQuery();
  const urlQ = onSearch ? (query.get("q") ?? "") : "";
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const composing = useRef(false);
  /** Запрос, который поле само записало в адрес: адрес с другим — пришёл извне («назад», ссылка). */
  const committed = useRef<string | undefined>(undefined);
  /** Идёт набор: следующие запросы заменяют запись истории. */
  const typing = useRef(false);
  /**
   * Допечатанное, пока страница поиска открывается с главной. Второй переход через роутер Next.js
   * меняет только параметры адреса той же страницы, и выдача о нём не узнала бы: текст ждёт здесь и
   * уходит в адрес сразу после перехода.
   */
  const pending = useRef<string | undefined>(undefined);
  /**
   * Свежие страница, параметры и переход: таймер паузы набора запускает функцию из того отрисовывания,
   * в котором нажата клавиша, — оно могло быть ещё до перехода на /search. Обновляются после показа, а
   * не во время отрисовки: страницу поиска React отрисовывает заранее, пока переход ещё идёт, и таймер
   * поменял бы адрес раньше, чем Next.js закончит переход, — выдача осталась бы от прежнего текста.
   */
  const latest = useRef({ onSearch, query, navigate });
  useLayoutEffect(() => {
    latest.current = { onSearch, query, navigate };
  });

  // Текст и фокус из поля шапки — после перехода на /search. Пока страница открывалась, в поле шапки
  // могли допечатать: адрес догоняет текст.
  useEffect(() => {
    if (!onSearch) return;
    const handed = takeHandoff();
    if (handed === undefined) return;
    const q = handed.trim();
    setValue(handed);
    committed.current = q;
    typing.current = true;
    navigate(new URLSearchParams(q === "" ? {} : { q }), { replace: true });
    const el = input.current;
    if (el) {
      el.focus();
      el.setSelectionRange(handed.length, handed.length);
    }
  }, [onSearch, navigate]);

  // Страница поиска открылась с главной — допечатанный за это время текст догоняет адрес.
  useEffect(() => {
    if (!onSearch) return;
    const q = pending.current;
    pending.current = undefined;
    if (q === undefined || q === committed.current) return;
    committed.current = q;
    navigate(new URLSearchParams(q === "" ? {} : { q }), { replace: true });
  }, [onSearch, navigate]);

  // Запрос из адреса: открыли ссылку, нажали «назад», выбрали пример.
  useEffect(() => {
    if (!onSearch || !ready || urlQ === committed.current) return;
    committed.current = urlQ;
    typing.current = false;
    setValue(urlQ);
  }, [onSearch, ready, urlQ]);

  // Вернулись на главную — поле пустое, как её адрес.
  useEffect(() => {
    if (onSearch) return;
    committed.current = undefined;
    typing.current = false;
    setValue("");
  }, [onSearch]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (text: string) => {
    clearTimeout(timer.current);
    const q = text.trim();
    const now = latest.current;
    if (!now.onSearch) {
      // Переход на /search уже идёт — текст подождёт его конца.
      if (typing.current) {
        pending.current = q;
        return;
      }
      if (q === "") return;
      committed.current = q;
      typing.current = true;
      router.push(`${searchPath}?${new URLSearchParams({ q })}`, {
        scroll: false,
      });
      return;
    }
    if (q === committed.current) return;
    committed.current = q;
    now.navigate(
      withParams(now.query, { q: q === "" ? undefined : q, page: undefined }),
      { replace: typing.current },
    );
    typing.current = true;
  };

  const schedule = (text: string) => {
    clearTimeout(timer.current);
    if (composing.current) return;
    timer.current = setTimeout(() => commit(text), TYPING_PAUSE_MS);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    commit(value);
    // На главной Enter не заканчивает набор: переход на /search ещё идёт.
    if (latest.current.onSearch) typing.current = false;
  };

  // Поле — один и тот же элемент на главной и в поиске: цепочка обёрток (div > div > search > form > div >
  // input) одинаковая, меняются только классы, а «AI Search» на главной — в форме, в поиске — в строке.
  // Иначе React пересоздал бы поле при переходе, и фокус с набранными буквами пропали бы.
  const field = (
    <div className={onSearch ? "hero-field grid-field" : "hero-field"}>
      <Icon icon="material-symbols:search" className="hero-field-icon" />
      <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
        {t.searchLabel}
      </label>
      <input
        ref={input}
        id={SEARCH_INPUT_ID}
        type="search"
        name="q"
        className="hero-input"
        value={value}
        maxLength={QUERY_MAX_LENGTH}
        placeholder={t.searchPlaceholder}
        autoComplete="off"
        aria-keyshortcuts="Control+K Meta+K"
        onChange={(e) => {
          setValue(e.target.value);
          schedule(e.target.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          schedule(e.currentTarget.value);
        }}
        onFocus={() => router.prefetch(searchPath)}
        onBlur={() => {
          typing.current = false;
        }}
      />
      <span className="hero-keys" aria-hidden="true">
        <kbd>Ctrl</kbd>
        <kbd>K</kbd>
      </span>
    </div>
  );

  return (
    <>
      {onSearch ? (
        // Шапка страницы поиска по макету «Сценарий поиска иконок»: крошки «Icon Sets / Search» и
        // «Search Results», на телефоне — «‹ Icon Sets»; оформление — как у страницы набора.
        <header className="set-head search-head">
          <div className="set-head-title">
            <Crumbs
              lang={lang}
              items={[{ path: "/", label: t.navIconSets }]}
              current={t.searchTitle}
            />
            <PageLink lang={lang} path="/" className="set-back">
              <Icon
                icon="material-symbols:keyboard-arrow-left"
                className="pill-chevron"
              />
              {t.navIconSets}
            </PageLink>
            <h1 className="set-title">{t.searchResultsTitle}</h1>
          </div>
        </header>
      ) : (
        intro
      )}
      <div
        className={
          onSearch ? "grid-toolbar-box search-toolbar-box" : "hero-search-box"
        }
      >
        <div className={onSearch ? "grid-toolbar" : "hero-search-row"}>
          <search className={onSearch ? "grid-search" : "hero-search"}>
            <form
              action={searchPath}
              className={onSearch ? "search-form" : "hero-search-form"}
              onSubmit={submit}
            >
              {field}
              {onSearch ? null : <AiSearch lang={lang} className="ai-search" />}
            </form>
          </search>
          {onSearch ? (
            <>
              <AiSearch lang={lang} className="ai-search ai-search-md" />
              <FilterButton lang={lang} />
              <ViewSwitch lang={lang} />
              <GridSettings lang={lang} />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
