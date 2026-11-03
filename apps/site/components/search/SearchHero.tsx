"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { QUERY_MAX_LENGTH, TYPING_PAUSE_MS } from "../../lib/search";
import { takeHandoff } from "../../lib/search-handoff";
import { useUrlQuery, withParams } from "../../lib/url-query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
 */
export function SearchHero({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const router = useRouter();
  const pathname = usePathname();
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

  return (
    <>
      <h1>{onSearch ? t.searchTitle : "Iconavo"}</h1>
      {onSearch ? null : <p className="lead">{t.homeLead}</p>}
      <search className="hero-search">
        <form
          action={searchPath}
          className="hero-search-form"
          onSubmit={submit}
        >
          <label htmlFor="hero-search" className="sr-only">
            {t.searchLabel}
          </label>
          <Input
            ref={input}
            id="hero-search"
            type="search"
            name="q"
            value={value}
            maxLength={QUERY_MAX_LENGTH}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
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
          <Button type="submit">{t.searchSubmit}</Button>
        </form>
      </search>
    </>
  );
}
