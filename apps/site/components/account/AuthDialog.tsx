"use client";

import { Icon } from "@iconavo-ui/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type AuthScreen,
  accountApi,
  authPanelStore,
  authRequestStore,
  clock,
  expectSignIn,
  googleUrls,
  INVALID_FIELD,
  type MessageKey,
  messageOf,
  normalEmail,
  PASSWORD,
  RESEND_SECONDS,
  type Reply,
  secondsLeft,
  signedIn,
  TURNSTILE_SCRIPT,
  userOf,
  useSession,
  validEmail,
  withCaptcha,
} from "../../lib/account";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PHONE, usePanelOpen } from "../../lib/panel-store";
import { isDark } from "../../lib/theme";
import { captchaToken } from "../../lib/turnstile";
import { GoogleLogo } from "../shell/Logos";
import { Soon } from "../shell/Soon";
import { CodeField, Field, PasswordField } from "./fields";
import { focusAccountButton } from "./ids";

type Errors = Partial<
  Record<"email" | "password" | "code" | "form", MessageKey>
>;

/** Ошибки кода — под клетками; остальное — общей строкой формы. */
const CODE_ERRORS = new Set([
  "INVALID_OTP",
  "OTP_EXPIRED",
  "TOO_MANY_ATTEMPTS",
]);

/**
 * Окно входа по макету «Авторизация / Регистрация / Забыли пароль» (шаг 3 фазы 5, PR 3; ADR-0055): слева
 * форма 400 px, справа градиент; на телефоне — шторка почти во весь экран, без градиента (решение
 * владельца 27 ноября 2026). Родной модальный <dialog>, как шторки сайта (ADR-0038): фокус внутри окна,
 * Esc и щелчок мимо закрывают, фокус возвращается на кнопку, которая открыла окно (или на кнопку аккаунта,
 * если та сменилась после входа).
 *
 * Экраны: вход; регистрация — почта → код → пароль → «You’re all set»; восстановление — почта → код →
 * новый пароль → «Password updated» (и сразу вход). Google — переход к Google и обратно на эту же
 * страницу. Turnstile — перед регистрацией, письмом с новым кодом и входом после трёх неудач.
 */
export default function AuthDialog({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const open = usePanelOpen(authPanelStore);
  const request = useSyncExternalStore(
    authRequestStore.subscribe,
    authRequestStore.get,
    authRequestStore.get,
  );
  const session = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const captchaBox = useRef<HTMLDivElement>(null);
  const pressedOutside = useRef(false);
  // Запрос уже идёт — второй щелчок до перерисовки не отправит второй (busy — для вида кнопок).
  const working = useRef(false);
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();

  const [serial, setSerial] = useState(request.serial);
  const [screen, setScreen] = useState<AuthScreen>(request.screen);
  const [errors, setErrors] = useState<Errors>(
    request.notice === undefined ? {} : { form: request.notice },
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  // Сервис сказал: следующий вход — только с Turnstile (три неудачи за 15 минут).
  const [captchaNext, setCaptchaNext] = useState(false);

  // Новое открытие — с экрана, который попросили, без ошибок и набранного кода.
  if (request.serial !== serial) {
    setSerial(request.serial);
    setScreen(request.screen);
    setErrors(request.notice === undefined ? {} : { form: request.notice });
    setPassword("");
    setCode("");
  }

  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Фокус — в первое поле экрана; на телефоне — на заголовок, чтобы клавиатура не открывалась сама.
  // biome-ignore lint/correctness/useExhaustiveDependencies: фокус — при открытии и смене экрана
  useEffect(() => {
    if (!open || dialog.current?.open !== true) return;
    if (first.current === null || window.matchMedia(PHONE).matches) {
      title.current?.focus();
    } else {
      first.current.focus();
    }
  }, [open, screen, serial]);

  // Esc закрывает только окно: панель иконки за ним его не получает.
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  const codeScreen = screen === "signup-code" || screen === "reset-code";
  useEffect(() => {
    if (!open || !codeScreen) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, codeScreen]);
  const wait = secondsLeft(sentAt, now);

  function close() {
    authPanelStore.set(false);
  }

  // Окно закрылось (Esc, ✕, щелчок мимо, готово): хранилище — в лад, пароль и код забыты, фокус — назад.
  function closed() {
    if (authPanelStore.get()) authPanelStore.set(false);
    setPassword("");
    setCode("");
    setBusy(false);
    const opener = authPanelStore.takeOpener();
    if (opener?.isConnected) opener.focus();
    else focusAccountButton();
  }

  function go(next: AuthScreen, keep: Errors = {}) {
    setScreen(next);
    setErrors(keep);
  }

  const solve = () => {
    const box = captchaBox.current;
    return box === null
      ? Promise.reject(new Error("turnstile: нет места для виджета"))
      : captchaToken(box, { src: TURNSTILE_SCRIPT, lang, dark: isDark() });
  };

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      setErrors({ form: "authErrorCaptcha" });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const submit = (action: () => Promise<void>) => (e: FormEvent) => {
    e.preventDefault();
    void action();
  };

  /** Поле поменяли — его ошибка и общая строка уходят. */
  const edit =
    (set: (value: string) => void, field: keyof Errors) => (value: string) => {
      set(value);
      if (errors[field] !== undefined || errors.form !== undefined) {
        setErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }));
      }
    };

  /** Ошибки на экране и фокус — в первое поле с ошибкой. */
  function fail(next: Errors) {
    setErrors(next);
    requestAnimationFrame(() => {
      const el = dialog.current;
      el?.querySelector<HTMLInputElement>(INVALID_FIELD)?.focus();
    });
  }

  const user = (reply: Reply, fallback: string) =>
    userOf(reply.data) ?? { email: fallback, name: "" };

  async function logIn() {
    const address = normalEmail(email);
    const problems: Errors = {};
    if (!validEmail(address)) problems.email = "authErrorEmail";
    if (password === "") problems.password = "authErrorPasswordEmpty";
    if (problems.email !== undefined || problems.password !== undefined) {
      fail(problems);
      return;
    }
    await run(async () => {
      const reply = await withCaptcha(
        (captcha) => accountApi.signIn(address, password, captcha),
        solve,
        captchaNext,
      );
      setCaptchaNext(reply.captcha);
      if (reply.ok) {
        signedIn(user(reply, address));
        close();
        return;
      }
      fail(
        reply.code === "INVALID_EMAIL_OR_PASSWORD"
          ? { password: "authErrorCredentials" }
          : { form: messageOf(reply.code) },
      );
    });
  }

  async function google() {
    await run(async () => {
      const reply = await accountApi.google(googleUrls(location.href));
      const url = reply.data?.url;
      if (reply.ok && typeof url === "string" && url.startsWith("https://")) {
        expectSignIn();
        location.assign(url);
        return;
      }
      fail({ form: "authErrorGoogle" });
    });
  }

  /** Письмо с кодом: регистрация или новый пароль; Turnstile — всегда. */
  async function sendCode(flow: "signup" | "reset", address: string) {
    const reply = await withCaptcha(
      (captcha) =>
        flow === "signup"
          ? accountApi.signUp(address, lang, captcha)
          : accountApi.requestReset(address, lang, captcha),
      solve,
      true,
    );
    if (reply.ok) {
      setEmail(address);
      setCode("");
      setSentAt(Date.now());
      setNow(Date.now());
    }
    return reply;
  }

  async function startSignUp() {
    const address = normalEmail(email);
    if (!validEmail(address)) {
      fail({ email: "authErrorEmail" });
      return;
    }
    await run(async () => {
      const reply = await sendCode("signup", address);
      if (reply.ok) {
        go("signup-code");
        return;
      }
      fail(
        ["EMAIL_TAKEN", "SIGN_UP_CLOSED", "INVALID_EMAIL"].includes(reply.code)
          ? { email: messageOf(reply.code) }
          : { form: messageOf(reply.code) },
      );
    });
  }

  async function startReset() {
    const address = normalEmail(email);
    if (!validEmail(address)) {
      fail({ email: "authErrorEmail" });
      return;
    }
    await run(async () => {
      const reply = await sendCode("reset", address);
      if (reply.ok) {
        go("reset-code");
        return;
      }
      fail(
        reply.code === "INVALID_EMAIL"
          ? { email: "authErrorEmail" }
          : { form: messageOf(reply.code) },
      );
    });
  }

  async function resend() {
    await run(async () => {
      const reply = await sendCode(
        screen === "signup-code" ? "signup" : "reset",
        email,
      );
      setErrors(reply.ok ? {} : { form: messageOf(reply.code) });
    });
  }

  const codeFailure = (reply: Reply): Errors =>
    CODE_ERRORS.has(reply.code)
      ? { code: messageOf(reply.code) }
      : { form: messageOf(reply.code) };

  async function confirmCode() {
    if (code.length !== 6) {
      fail({ code: "authErrorCodeIncomplete" });
      return;
    }
    await run(async () => {
      if (screen === "signup-code") {
        const reply = await accountApi.signUpCode(email, code, lang);
        if (reply.ok) {
          signedIn(user(reply, email));
          setCode("");
          go("signup-password");
          return;
        }
        fail(codeFailure(reply));
        return;
      }
      const reply = await accountApi.checkReset(email, code);
      if (reply.ok) {
        go("reset-password");
        return;
      }
      fail(codeFailure(reply));
    });
  }

  const passwordLength = () =>
    password.length < PASSWORD.min || password.length > PASSWORD.max
      ? ({ password: "authErrorPasswordLength" } as Errors)
      : undefined;

  async function createPassword() {
    const problem = passwordLength();
    if (problem !== undefined) {
      fail(problem);
      return;
    }
    await run(async () => {
      const reply = await accountApi.setPassword(password);
      if (reply.ok || reply.code === "PASSWORD_ALREADY_SET") {
        setPassword("");
        go("signup-done");
        return;
      }
      fail(
        reply.code === "INVALID_PASSWORD_LENGTH" ||
          reply.code === "PASSWORD_WINDOW_CLOSED"
          ? { password: messageOf(reply.code) }
          : { form: messageOf(reply.code) },
      );
    });
  }

  async function savePassword() {
    const problem = passwordLength();
    if (problem !== undefined) {
      fail(problem);
      return;
    }
    await run(async () => {
      const reset = await accountApi.resetPassword(email, code, password);
      if (!reset.ok) {
        if (CODE_ERRORS.has(reset.code)) {
          go("reset-code", { code: messageOf(reset.code) });
          return;
        }
        fail(
          reset.code === "PASSWORD_TOO_SHORT" ||
            reset.code === "PASSWORD_TOO_LONG"
            ? { password: "authErrorPasswordLength" }
            : { form: messageOf(reset.code) },
        );
        return;
      }
      // Пароль сменили — сразу вход им (макет: «…and you’re logged in»).
      const reply = await withCaptcha(
        (captcha) => accountApi.signIn(email, password, captcha),
        solve,
        false,
      );
      setPassword("");
      setCode("");
      if (reply.ok) {
        signedIn(user(reply, email));
        go("reset-done");
        return;
      }
      go("login", { form: messageOf(reply.code) });
    });
  }

  // ——— Разметка ———

  const nav = (back?: AuthScreen) => (
    <div className="auth-nav">
      {back === undefined ? null : (
        <button
          type="button"
          className="auth-nav-button"
          onClick={() => go(back)}
        >
          <Icon
            icon="material-symbols:keyboard-arrow-left"
            className="auth-nav-icon"
          />
          {t.authBack}
        </button>
      )}
      <button type="button" className="auth-nav-button" onClick={close}>
        <Icon icon="material-symbols:close" className="auth-nav-icon" />
        {t.authClose}
      </button>
    </div>
  );

  const heading = (text: string, description?: ReactNode) => (
    <div className="auth-title-group">
      <h2 id={titleId} ref={title} tabIndex={-1} className="auth-title">
        {text}
      </h2>
      {description === undefined ? null : (
        <p className="auth-description">{description}</p>
      )}
    </div>
  );

  const googleButton = (label: string) => (
    <button
      type="button"
      className="auth-google"
      aria-disabled={busy ? "true" : undefined}
      onClick={() => void google()}
    >
      <GoogleLogo />
      {label}
    </button>
  );

  const formError =
    errors.form === undefined ? null : (
      <p className="auth-note auth-note-error" role="alert">
        {t[errors.form]}
      </p>
    );

  const captcha = <div ref={captchaBox} className="auth-captcha" />;

  const primary = (label: string) => (
    <button
      type="submit"
      className="auth-primary"
      aria-disabled={busy ? "true" : undefined}
    >
      {label}
    </button>
  );

  const footer = (question: string, link: string, to: AuthScreen) => (
    <>
      <div className="auth-divider" />
      <div className="auth-footer">
        <p>{question}</p>
        <button type="button" className="auth-link" onClick={() => go(to)}>
          {link}
        </button>
      </div>
    </>
  );

  const strong = (text: string) => (
    <strong className="auth-email">{text}</strong>
  );

  const emailField = (
    <Field
      t={t}
      id={emailId}
      label={t.authEmail}
      type="email"
      value={email}
      onChange={edit(setEmail, "email")}
      autoComplete="username"
      error={errors.email}
      inputRef={first}
    />
  );

  /** Почта для менеджера паролей рядом с новым паролем — сохранить их парой. */
  const username = (
    <input
      className="sr-only"
      type="email"
      autoComplete="username"
      value={email}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
    />
  );

  const newPasswordField = (label: string) => (
    <PasswordField
      t={t}
      id={passwordId}
      label={label}
      value={password}
      onChange={edit(setPassword, "password")}
      autoComplete="new-password"
      error={errors.password}
      hint={t.authPasswordHint}
      inputRef={first}
    />
  );

  const done = (head: string, text: ReactNode, button: string) => (
    <>
      <div className="auth-head">{nav()}</div>
      <div className="auth-done">
        <span className="auth-badge" aria-hidden="true">
          <Icon icon="material-symbols:check" />
        </span>
        {heading(head, text)}
        <button type="button" className="auth-primary" onClick={close}>
          {button}
        </button>
      </div>
    </>
  );

  let body: ReactNode;
  switch (screen) {
    case "login":
      body = (
        <>
          <div className="auth-head">
            {nav()}
            {heading(t.authLoginTitle)}
            {googleButton(t.authLoginGoogle)}
          </div>
          <div className="auth-divider" />
          <form className="auth-form" noValidate onSubmit={submit(logIn)}>
            <p className="auth-lead">{t.authLoginEmail}</p>
            <div className="auth-fields">
              {emailField}
              <PasswordField
                t={t}
                id={passwordId}
                label={t.authPassword}
                value={password}
                onChange={edit(setPassword, "password")}
                autoComplete="current-password"
                error={errors.password}
                inputRef={passwordInput}
              />
            </div>
            <button
              type="button"
              className="auth-link auth-forgot"
              onClick={() => go("reset")}
            >
              {t.authForgot}
            </button>
            {formError}
            {captcha}
            {primary(t.authLogIn)}
          </form>
          {footer(t.authNoAccount, t.authCreateFree, "signup")}
        </>
      );
      break;
    case "signup":
      body = (
        <>
          <div className="auth-head">
            {nav()}
            {heading(t.authSignUpTitle)}
            {googleButton(t.authSignUpGoogle)}
          </div>
          <div className="auth-divider" />
          <form className="auth-form" noValidate onSubmit={submit(startSignUp)}>
            <p className="auth-lead">{t.authSignUpEmail}</p>
            {emailField}
            {formError}
            {captcha}
            {primary(t.authContinue)}
            <p className="auth-terms">
              {t.authTermsBefore}
              <Soon lang={lang} className="auth-terms-link">
                {t.authTerms}
              </Soon>
              {t.authTermsAnd}
              <Soon lang={lang} className="auth-terms-link">
                {t.authPrivacy}
              </Soon>
            </p>
          </form>
          {footer(t.authHaveAccount, t.authLogIn, "login")}
        </>
      );
      break;
    case "signup-code":
    case "reset-code": {
      const back = screen === "signup-code" ? "signup" : "reset";
      body = (
        <>
          <div className="auth-head">
            {nav(back)}
            {heading(
              t.authCodeTitle,
              <>
                {t.authCodeSent}
                {strong(email)}
                {screen === "signup-code" ? t.authCodeSignUp : t.authCodeReset}
              </>,
            )}
          </div>
          <div className="auth-divider" />
          <form className="auth-form" noValidate onSubmit={submit(confirmCode)}>
            <CodeField
              t={t}
              value={code}
              onChange={edit(setCode, "code")}
              error={errors.code}
              inputRef={first}
            />
            {formError}
            {primary(t.authConfirm)}
            <p className="auth-resend">
              {wait > 0 ? (
                t.authResendIn.replace(
                  "{time}",
                  // Сразу после письма — «0:59», как в макете, а не «1:00».
                  clock(Math.min(wait, RESEND_SECONDS - 1)),
                )
              ) : (
                <>
                  {t.authNoCode}{" "}
                  <button
                    type="button"
                    className="auth-link"
                    aria-disabled={busy ? "true" : undefined}
                    onClick={() => void resend()}
                  >
                    {t.authResend}
                  </button>
                </>
              )}
            </p>
            {captcha}
          </form>
          {footer(t.authWrongEmail, t.authChangeEmail, back)}
        </>
      );
      break;
    }
    case "signup-password":
      body = (
        <>
          <div className="auth-head">
            {nav()}
            {heading(
              t.authPasswordTitle,
              <>
                {t.authPasswordFor}
                {strong(email)}
              </>,
            )}
          </div>
          <div className="auth-divider" />
          <form
            className="auth-form"
            noValidate
            onSubmit={submit(createPassword)}
          >
            {username}
            {newPasswordField(t.authPassword)}
            {formError}
            {primary(t.authCreateAccount)}
          </form>
        </>
      );
      break;
    case "signup-done":
      body = done(
        t.authDoneTitle,
        <>
          {t.authDoneText}
          {strong(session.status === "signed-in" ? session.user.email : email)}
        </>,
        t.authStart,
      );
      break;
    case "reset":
      body = (
        <>
          <div className="auth-head">
            {nav("login")}
            {heading(t.authResetTitle, t.authResetText)}
          </div>
          <div className="auth-divider" />
          <form className="auth-form" noValidate onSubmit={submit(startReset)}>
            {emailField}
            {formError}
            {captcha}
            {primary(t.authSendCode)}
          </form>
          {footer(t.authRemember, t.authLogIn, "login")}
        </>
      );
      break;
    case "reset-password":
      body = (
        <>
          <div className="auth-head">
            {nav("reset-code")}
            {heading(
              t.authNewPasswordTitle,
              <>
                {t.authNewPasswordFor}
                {strong(email)}
              </>,
            )}
          </div>
          <div className="auth-divider" />
          <form
            className="auth-form"
            noValidate
            onSubmit={submit(savePassword)}
          >
            {username}
            {newPasswordField(t.authNewPassword)}
            {formError}
            {primary(t.authSavePassword)}
          </form>
        </>
      );
      break;
    case "reset-done":
      body = done(t.authResetDoneTitle, t.authResetDoneText, t.authContinue);
      break;
  }

  return (
    // Щелчок по затемнению попадает в сам <dialog>: закрыть, если и нажали мимо окна (выделение текста,
    // отпущенное за краем, окно не закрывает).
    // biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры окно закрывают Esc и «Close»
    <dialog
      ref={dialog}
      className="auth-dialog"
      aria-labelledby={titleId}
      data-screen={screen}
      onClose={closed}
      onPointerDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOutside.current) close();
      }}
    >
      <div className="auth-panel">
        <span className="auth-handle" aria-hidden="true" />
        {body}
      </div>
      <div className="auth-art preview-dark" aria-hidden="true" />
    </dialog>
  );
}
