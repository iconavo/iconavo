"use client";

import { Icon } from "@iconavo-ui/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { FIRST_FIELD, OPEN_DIALOG } from "../../lib/account";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PHONE } from "../../lib/panel-store";

/**
 * Окно кабинета (кадры C2, D2, E2, F2 и B2 макета «Личный кабинет»): 440 px посередине на bg/surfaceMuted, «×
 * Close», заголовок 24/28, пояснение, поля, черта и внизу две кнопки — «Cancel» и главная (лимонная или
 * красная у удаления). На телефоне — шторка снизу по высоте содержимого. Родной модальный <dialog>: фокус
 * внутри, Esc и щелчок мимо закрывают, фокус возвращается на кнопку, которая открыла окно.
 */
export function CabinetDialog({
  lang,
  open,
  onClose,
  title,
  description,
  children,
  action,
  danger,
  busy,
  onSubmit,
  back,
  name,
  step,
  opener,
}: {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Главная кнопка. */
  action: string;
  /** Главная кнопка — красная (удаление). */
  danger?: boolean;
  busy?: boolean;
  onSubmit: () => void;
  /** «Back» вместо «Cancel» — у второго шага (код). */
  back?: () => void;
  /** Имя окна для проверок: data-dialog. */
  name: string;
  /** Шаг окна (почта → код): сменился — фокус в первое поле нового шага. */
  step?: string;
  /**
   * Кнопка, которая открыла окно: туда вернётся фокус. Нужна явно — Safari и WebKit не ставят фокус на
   * кнопку по щелчку, и document.activeElement у них при открытии — body. Нет — тот, кто в фокусе.
   */
  opener?: { readonly current: HTMLElement | null };
}) {
  const t = DICTIONARIES[lang];
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<Element | null>(null);
  const pressedOutside = useRef(false);
  // Открыто ли окно по мнению страницы: закрыл браузер (Esc) — сказать странице; закрыла сама страница
  // (окно сменилось другим) — молчать, иначе событие close закрыло бы и новое окно.
  const wanted = useRef(open);
  const titleId = useId();

  /** Фокус — в первое поле; на телефоне и без полей — на заголовок (клавиатура не закрывает шторку). */
  const focusFirst = () => {
    const field = dialog.current?.querySelector<HTMLInputElement>(FIRST_FIELD);
    if (field == null || window.matchMedia(PHONE).matches) {
      heading.current?.focus();
    } else {
      field.focus();
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: окно открывается и закрывается только по open
  useEffect(() => {
    wanted.current = open;
    const el = dialog.current;
    if (el === null) return;
    if (open && !el.open) {
      returnTo.current = opener?.current ?? document.activeElement;
      el.showModal();
      focusFirst();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Следующий шаг того же окна (почта → код) — фокус в его первое поле.
  // biome-ignore lint/correctness/useExhaustiveDependencies: только при смене шага
  useEffect(() => {
    if (dialog.current?.open) focusFirst();
  }, [step]);

  // Esc закрывает только окно: панель иконки и меню за ним его не получают.
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры окно закрывают Esc и «Close»
    <dialog
      ref={dialog}
      className="cabinet-dialog"
      aria-labelledby={titleId}
      data-dialog={name}
      onClose={() => {
        if (wanted.current) {
          wanted.current = false;
          onClose();
        }
        // Фокус — на кнопку, которая открыла окно, если его не сменило другое окно.
        const back = returnTo.current;
        if (
          back instanceof HTMLElement &&
          back.isConnected &&
          document.querySelector(OPEN_DIALOG) === null
        ) {
          back.focus();
        }
      }}
      onPointerDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOutside.current) onClose();
      }}
    >
      <form className="cabinet-dialog-form" noValidate onSubmit={submit}>
        <span className="auth-handle" aria-hidden="true" />
        <div className="cabinet-dialog-head">
          <button type="button" className="auth-nav-button" onClick={onClose}>
            <Icon icon="material-symbols:close" className="auth-nav-icon" />
            {t.authClose}
          </button>
          <h2 id={titleId} ref={heading} tabIndex={-1} className="auth-title">
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="auth-description">{description}</p>
          )}
        </div>
        {children === undefined ? null : (
          <div className="cabinet-dialog-body">{children}</div>
        )}
        <div className="auth-divider" />
        <div className="cabinet-dialog-foot">
          <button
            type="button"
            className="cabinet-secondary"
            onClick={back ?? onClose}
          >
            {back === undefined ? t.cancel : t.authBack}
          </button>
          <button
            type="submit"
            className={danger ? "cabinet-danger" : "auth-primary"}
            aria-disabled={busy ? "true" : undefined}
          >
            {action}
          </button>
        </div>
      </form>
    </dialog>
  );
}
