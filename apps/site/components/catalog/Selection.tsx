"use client";

import { Icon } from "@iconavo-ui/react";
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { track } from "../../lib/analytics";
import { BAG_LIMIT, bagStore, missingMessage, useBag } from "../../lib/bag";
import { ZIP_NAME } from "../../lib/bag-files";
import { cn } from "../../lib/cn";
import { saveFile } from "../../lib/download";
import { countOf, type Forms, ICON_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { SELECT_LIMIT, toggleSelected } from "../../lib/selection";

/** «Download 8 Icons» — слово с большой буквы, как в макете; по-русски — обычные формы. */
const DOWNLOAD_FORMS: Record<Lang, Forms> = {
  en: { one: "Icon", other: "Icons" },
  ru: ICON_FORMS.ru,
};

/** Выделение сетки: выбранные иконки и что с ними делать. */
export interface Selection {
  picked: readonly string[];
  toggle: (name: string) => void;
  clear: () => void;
  /** Выбрано 100 — новые не выбираются. */
  full: boolean;
  /** Элемент над сеткой, место которого держится, когда строка выбора появляется или уходит. */
  anchor: RefObject<HTMLDivElement | null>;
}

/**
 * Выбор иконок на странице (сценарий «Выделение» макета): до 100, пока страница открыта. Строка выбора
 * над поиском появляется с первой отметкой и уходит с последней — сетка под курсором при этом не
 * прыгает: страница прокручивается ровно на столько, на сколько сдвинулся якорь (anchor).
 */
export function useSelection(): Selection {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const anchor = useRef<HTMLDivElement>(null);
  const before = useRef<number | undefined>(undefined);

  // После каждой смены выбора: якорь сдвинулся (строка выбора появилась или ушла) — вернуть его на место.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = undefined;
    if (was === undefined || anchor.current === null) return;
    const delta = anchor.current.getBoundingClientRect().top - was;
    if (Math.abs(delta) >= 1)
      window.scrollBy({ top: delta, behavior: "instant" });
  });

  return {
    picked,
    toggle: useCallback((name: string) => {
      before.current = anchor.current?.getBoundingClientRect().top;
      setPicked((list) => toggleSelected(list, name).list);
    }, []),
    clear: useCallback(() => {
      before.current = anchor.current?.getBoundingClientRect().top;
      setPicked([]);
    }, []),
    full: picked.length >= SELECT_LIMIT,
    anchor,
  };
}

/**
 * Строка выбора (макет «Selection Mode / Selected»): Download N Icons — ZIP с исходными SVG, текстами
 * лицензий и README (решение владельца 13 ноября 2026), Cancel Selection — снять выбор, справа «N/100».
 * Прилипает к верху окна: кнопка скачивания под рукой, где бы на странице ни отмечали иконки.
 */
export function SelectionBar({
  lang,
  selection,
}: {
  lang: Lang;
  selection: Selection;
}) {
  const t = DICTIONARIES[lang];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Не вошли в последний ZIP (ревизия фазы 5, С-11); в аналитике — иконки в файле (С-29).
  const [note, setNote] = useState<string>();
  const { picked } = selection;
  if (picked.length === 0) return null;

  async function download() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setNote(undefined);
    try {
      const m = await import("../../lib/bag-export");
      const zip = await m.bagZip(picked, {});
      setNote(missingMessage(t, zip.missing, zip.file === undefined));
      if (zip.file === undefined) return;
      saveFile(ZIP_NAME, zip.file, "application/zip");
      track({ name: "download", format: "zip", count: zip.count });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="select-bar">
      <div className="select-actions">
        <button
          type="button"
          className="panel-btn panel-btn-primary"
          aria-disabled={busy}
          onClick={download}
        >
          <Icon icon="material-symbols:download" className="panel-icon" />
          <span>
            {t.selDownload.replace(
              "{count}",
              countOf(lang, picked.length, DOWNLOAD_FORMS[lang]),
            )}
          </span>
        </button>
        <button
          type="button"
          className="panel-btn select-cancel"
          onClick={selection.clear}
        >
          <Icon icon="material-symbols:close" className="panel-icon" />
          <span>{t.selCancel}</span>
        </button>
      </div>
      <p className="select-count" role="status">
        {failed
          ? t.iconDownloadFailed
          : note !== undefined
            ? note
            : selection.full
              ? t.selFull
              : t.selCount
                  .replace("{n}", String(picked.length))
                  .replace("{max}", String(SELECT_LIMIT))}
      </p>
    </div>
  );
}

/**
 * Кнопки карточки при наведении (Icon Card, State=Hover): слева — в рюкзак и обратно, справа — выбор.
 * Отмеченная карточка держит свой чекбокс на виду (State=Selected-Check). Это соседи ссылки-карточки, а
 * не её содержимое: кнопка внутри ссылки — ошибка разметки. На экранах уже 768 px их нет — выделения
 * на телефоне нет (гайд макета). Пропсы — простые значения, а не всё выделение: карточка сетки
 * (React.memo) не рисуется заново, пока её собственная отметка не изменилась.
 */
export function CardTools({
  lang,
  name,
  label,
  picked,
  full,
  onToggle,
}: {
  lang: Lang;
  /** Полное имя иконки. */
  name: string;
  /** Как иконку называет карточка — для подписей кнопок. */
  label: string;
  /** Иконка отмечена. */
  picked: boolean;
  /** Выбрано 100 — новые не выбираются. */
  full: boolean;
  onToggle: (name: string) => void;
}) {
  const t = DICTIONARIES[lang];
  const bag = useBag();
  const inBag = bag.includes(name);
  // Сумка полна — кнопка так и говорит, а не молчит (ревизия фазы 5, С-14).
  const bagFull = !inBag && bag.length >= BAG_LIMIT;
  const fullText = t.bagFull.replace("{max}", String(BAG_LIMIT));
  return (
    <>
      <button
        type="button"
        className={cn("card-tool card-bag", inBag && "card-tool-on")}
        aria-pressed={inBag}
        aria-disabled={bagFull || undefined}
        title={bagFull ? fullText : undefined}
        aria-label={
          bagFull
            ? fullText
            : (inBag ? t.selBagIn : t.selBag).replace("{name}", label)
        }
        onClick={() => bagStore.toggle(name)}
      >
        <Icon
          icon={inBag ? "material-symbols:check" : "site:backpack-add"}
          className="card-tool-icon"
        />
      </button>
      <label className={cn("card-tool card-check", picked && "card-tool-on")}>
        <input
          type="checkbox"
          className="card-check-input"
          checked={picked}
          disabled={!picked && full}
          onChange={() => onToggle(name)}
          aria-label={t.selPick.replace("{name}", label)}
        />
        <Icon
          icon={
            picked
              ? "material-symbols:check-box"
              : "material-symbols:check-box-outline-blank"
          }
          className="card-tool-icon"
        />
      </label>
    </>
  );
}
