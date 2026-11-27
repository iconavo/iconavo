"use client";

import { Icon } from "@iconavo-ui/react";
import { type ReactNode, type Ref, useId, useState } from "react";
import { CODE_LENGTH, digitsOnly, type MessageKey } from "../../lib/account";
import type { Dictionary } from "../../lib/i18n";

/**
 * Поле окна входа (компонент Input макета): подпись внутри рамки 44 px. Пустое поле — подпись вместо
 * подсказки; в фокусе — подпись сверху мелко, значение ниже; заполненное без фокуса — только значение
 * (подпись остаётся для скринридера). Всё это — стилями по :focus-within и :placeholder-shown, без
 * JavaScript. Ошибка — красная рамка и текст под полем, подсказка — серым там же.
 */
export function Field({
  t,
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  error,
  hint,
  inputRef,
  trailing,
}: {
  t: Dictionary;
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: MessageKey;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Кнопка справа в рамке — «показать пароль». */
  trailing?: ReactNode;
}) {
  const note = `${id}-note`;
  return (
    <div
      className="auth-input"
      data-invalid={error === undefined ? undefined : ""}
    >
      <div
        className="auth-field"
        data-trailing={trailing === undefined ? undefined : ""}
      >
        <input
          ref={inputRef}
          id={id}
          className="auth-field-input"
          type={type}
          value={value}
          placeholder=" "
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={
            error !== undefined || hint !== undefined ? note : undefined
          }
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        <label className="auth-field-label" htmlFor={id}>
          {label}
        </label>
        {trailing}
      </div>
      {error !== undefined ? (
        <p id={note} className="auth-note auth-note-error">
          {t[error]}
        </p>
      ) : hint !== undefined ? (
        <p id={note} className="auth-note">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Пароль с кнопкой «показать» (значок глаза макета). */
export function PasswordField(
  props: Omit<Parameters<typeof Field>[0], "type" | "trailing">,
) {
  const [shown, setShown] = useState(false);
  return (
    <Field
      {...props}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          className="auth-eye"
          aria-label={props.t.authShowPassword}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <Icon
            icon={
              shown
                ? "material-symbols:visibility-off"
                : "material-symbols:visibility"
            }
          />
        </button>
      }
    />
  );
}

/**
 * Код из письма (компонент Code Input макета): шесть клеток 52 × 56 — рисунок, а вводит одно настоящее поле
 * поверх них, прозрачное. Так работают вставка целиком, подсказка кода из письма у телефона
 * (autocomplete=one-time-code) и скринридер: для него это одно поле «Код из письма».
 */
export function CodeField({
  t,
  value,
  onChange,
  error,
  inputRef,
}: {
  t: Dictionary;
  value: string;
  onChange: (value: string) => void;
  error?: MessageKey;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const note = `${id}-note`;
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div
      className="auth-input auth-code"
      data-invalid={error === undefined ? undefined : ""}
    >
      <div className="auth-code-box">
        <input
          ref={inputRef}
          id={id}
          className="auth-code-input"
          value={value}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          aria-label={t.authCode}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : note}
          onChange={(e) => onChange(digitsOnly(e.currentTarget.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <span className="auth-code-cells" aria-hidden="true">
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: клетки постоянные, по порядку
              key={i}
              className="auth-code-cell"
              data-active={
                focused && i === active && value.length < CODE_LENGTH
                  ? ""
                  : undefined
              }
            >
              {value[i] ?? ""}
            </span>
          ))}
        </span>
      </div>
      {error === undefined ? null : (
        <p id={note} className="auth-note auth-note-error">
          {t[error]}
        </p>
      )}
    </div>
  );
}
