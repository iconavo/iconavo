"use client";

import { Icon } from "@iconavo-ui/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  authPanelStore,
  cabinetApi,
  clock,
  forgetSession,
  initialOf,
  linkUrls,
  type Me,
  type MessageKey,
  messageOf,
  normalEmail,
  openAuth,
  PASSWORD,
  patchUser,
  photoUrl,
  RESEND_SECONDS,
  type Reply,
  refreshSession,
  secondsLeft,
  useAccountsEnabled,
  useSession,
  validEmail,
} from "../../lib/account";
import { changedAgo, photoFileProblem } from "../../lib/crop";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { usePanelOpen } from "../../lib/panel-store";
import { toastStore } from "../../lib/toast";
import { GoogleLogo } from "../shell/Logos";
import { CabinetDialog } from "./CabinetDialog";
import { CodeField, Field, PasswordField } from "./fields";
import { PhotoDialog } from "./PhotoDialog";

/**
 * Кабинет «My account» (шаг 3 фазы 5, PR 4; кадры A2 и B–F макета «Личный кабинет»): страница статическая,
 * данные приходят в браузере (GET /api/account/me сервиса). В закрытом режиме — «скоро», гостю — вход.
 */
export function Cabinet({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const enabled = useAccountsEnabled();
  const session = useSession();
  const authOpen = usePanelOpen(authPanelStore);
  const [me, setMe] = useState<Me | "error" | null>(null);
  const signedIn = enabled && session.status === "signed-in";

  const load = async () => {
    const reply = await cabinetApi.me();
    if (reply.status === 401) {
      // Сеанса у сервиса уже нет (вышли в другой вкладке, истёк): браузер узнаёт это и показывает вход.
      setMe(null);
      await refreshSession();
      return;
    }
    setMe(reply.ok && reply.data !== null ? reply.data : "error");
  };

  /** Правка данных кабинета — от свежего состояния: «Undo» из сообщения приходит позже. */
  const update = (change: (me: Me) => Me) =>
    setMe((prev) => (prev === null || prev === "error" ? prev : change(prev)));

  // Вошли — данные; окно входа закрылось (пароль задан восстановлением) — свежие данные.
  // biome-ignore lint/correctness/useExhaustiveDependencies: перечитывать — при входе и после окна входа
  useEffect(() => {
    if (!signedIn) {
      setMe(null);
      return;
    }
    if (!authOpen) void load();
  }, [signedIn, authOpen]);

  if (!enabled) return <p className="cabinet-note">{t.accountSoon}</p>;
  if (session.status === "guest") {
    return (
      <div className="cabinet-note">
        <p>{t.accountGuest}</p>
        <button
          type="button"
          className="auth-primary cabinet-note-button"
          onClick={(e) => openAuth("login", { opener: e.currentTarget })}
        >
          {t.topLogIn}
        </button>
      </div>
    );
  }
  if (me === "error") {
    return (
      <div className="cabinet-note" role="alert">
        <p>{t.accountLoadError}</p>
        <button
          type="button"
          className="cabinet-secondary"
          onClick={() => void load()}
        >
          {t.accountRetry}
        </button>
      </div>
    );
  }
  if (me === null) {
    return <div className="cabinet-skeleton" aria-busy="true" />;
  }
  return <CabinetView lang={lang} me={me} update={update} reload={load} />;
}

type DialogName =
  | "crop"
  | "email"
  | "email-code"
  | "password"
  | "disconnect"
  | "set-first"
  | "delete";

type Errors = Partial<
  Record<"email" | "password" | "next" | "code" | "form", MessageKey>
>;

function Row({
  id,
  title,
  text,
  children,
}: {
  id: string;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <section className="cabinet-row" aria-labelledby={id}>
      <div className="cabinet-label">
        <h2 id={id} className="cabinet-row-title">
          {title}
        </h2>
        <p className="cabinet-row-text">{text}</p>
      </div>
      <div className="cabinet-controls">{children}</div>
    </section>
  );
}

function CabinetView({
  lang,
  me,
  update,
  reload,
}: {
  lang: Lang;
  me: Me;
  update: (change: (me: Me) => Me) => void;
  reload: () => Promise<void>;
}) {
  const t = DICTIONARIES[lang];
  const router = useRouter();
  const ids = {
    profile: useId(),
    email: useId(),
    password: useId(),
    signIn: useId(),
    notifications: useId(),
    remove: useId(),
    name: useId(),
    newEmail: useId(),
    currentEmail: useId(),
    currentPassword: useId(),
    currentDelete: useId(),
    next: useId(),
    confirm: useId(),
  };
  const fileInput = useRef<HTMLInputElement>(null);
  /** Кнопка строки, открывшая окно: туда вернётся фокус (Safari не ставит фокус на кнопку по щелчку). */
  const opener = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [errors, setErrors] = useState<Errors>({});
  const [photoError, setPhotoError] = useState(false);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const [cropError, setCropError] = useState<MessageKey | undefined>();
  const [name, setName] = useState(me.name);
  const [nameError, setNameError] = useState<MessageKey | undefined>();
  const savedName = useRef(me.name);
  const savingName = useRef<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setName(me.name);
    savedName.current = me.name;
  }, [me.name]);

  useEffect(() => {
    if (dialog !== "email-code") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [dialog]);

  /** Сменить окно: без ошибок; закрыть — забыть пароли и код. from — кнопка строки: туда вернётся фокус. */
  const open = (next: DialogName | null, from?: HTMLElement) => {
    if (from !== undefined) opener.current = from;
    setErrors({});
    if (next === null || next === "email" || next === "password") {
      setCurrent("");
      setNext("");
      setCode("");
    }
    if (next === "delete") {
      setTyped("");
      setCurrent("");
    }
    setDialog(next);
  };

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  /** Общие ошибки пароля и сети. */
  const passwordFailure = (
    reply: Reply,
    field: "password" | "email" = "password",
  ): Errors | "set-first" => {
    switch (reply.code) {
      case "PASSWORD_REQUIRED":
        return "set-first";
      case "INVALID_PASSWORD":
        return { [field]: "cabinetErrorPassword" };
      case "TOO_MANY_ATTEMPTS":
        return { [field]: "cabinetErrorTooMany" };
      default:
        return { form: messageOf(reply.code) };
    }
  };

  const fail = (result: Errors | "set-first") => {
    if (result === "set-first") open("set-first");
    else setErrors(result);
  };

  // ——— Профиль: фото ———

  /** Картинка в окне обрезки живёт, пока окно открыто; потом её память отдаётся. */
  const dropImage = () => {
    bitmap.current?.close();
    bitmap.current = null;
    setImage(null);
    setCropError(undefined);
  };

  /**
   * Файл → картинка для обрезки. createImageBitmap, а не <img> с адресом blob: строгая CSP сайта пускает
   * картинки только с самого сайта, data: и сервиса аккаунтов.
   */
  const pickFile = async (file: File | undefined) => {
    if (file === undefined) return;
    if (photoFileProblem(file) !== undefined) {
      setPhotoError(true);
      return;
    }
    const picture = await createImageBitmap(file).catch(() => null);
    if (
      picture === null ||
      photoFileProblem(file, picture.width, picture.height) !== undefined
    ) {
      picture?.close();
      setPhotoError(true);
      return;
    }
    dropImage();
    bitmap.current = picture;
    setPhotoError(false);
    setImage(picture);
    open("crop");
  };

  const applyPhoto = (photo: string | null) => {
    update((m) => ({ ...m, photo }));
    const url = photoUrl(photo);
    patchUser(url === undefined ? { photo: undefined } : { photo: url });
  };

  const savePhoto = (blob: Blob) =>
    run(async () => {
      const reply = await cabinetApi.photo(blob);
      if (!reply.ok || reply.data === null) {
        // Файл не подошёл — подсказка под кнопкой (B2e); сеть — ошибка в окне, обрезка остаётся.
        if (["UNSUPPORTED_IMAGE", "INVALID_IMAGE_SIZE"].includes(reply.code)) {
          setPhotoError(true);
          open(null);
          dropImage();
        } else {
          setCropError(messageOf(reply.code));
        }
        return;
      }
      applyPhoto(reply.data.photo);
      open(null);
      dropImage();
      toastStore.show(t.toastPhotoUpdated, {
        label: t.undo,
        run: () => void undoPhoto(),
      });
    });

  const undoPhoto = async () => {
    const reply = await cabinetApi.undoPhoto();
    if (reply.ok && reply.data !== null) applyPhoto(reply.data.photo);
    else toastStore.show(t[messageOf(reply.code)]);
  };

  const removePhoto = () =>
    run(async () => {
      const reply = await cabinetApi.removePhoto();
      if (!reply.ok) {
        toastStore.show(t[messageOf(reply.code)]);
        return;
      }
      applyPhoto(null);
      toastStore.show(t.toastPhotoRemoved, {
        label: t.undo,
        run: () => void undoPhoto(),
      });
    });

  // ——— Профиль: имя ———

  const saveName = async (value: string, withUndo = true) => {
    const clean = value.trim();
    // То же, что сохранено (и пустое у того, кто имени не задавал), — не ошибка и не запрос.
    if (clean === savedName.current) {
      setNameError(undefined);
      return;
    }
    if (clean === "") {
      setNameError("cabinetErrorName");
      return;
    }
    // Enter и уход с поля — одно сохранение.
    if (clean === savingName.current) return;
    savingName.current = clean;
    const previous = savedName.current;
    try {
      const reply = await cabinetApi.profile({ name: clean });
      if (!reply.ok || reply.data === null) {
        setNameError(
          reply.code === "NAME_TOO_LONG"
            ? "cabinetErrorNameLong"
            : reply.code === "NAME_EMPTY"
              ? "cabinetErrorName"
              : messageOf(reply.code),
        );
        return;
      }
      const saved = reply.data.name;
      setNameError(undefined);
      savedName.current = saved;
      update((m) => ({ ...m, name: saved }));
      patchUser({ name: saved });
      // Вернуть пустое имя сервис не даёт (NAME_EMPTY) — тогда и «Undo» нет.
      if (withUndo && previous !== "") {
        toastStore.show(t.toastNameSaved, {
          label: t.undo,
          run: () => void saveName(previous, false),
        });
      } else if (withUndo) {
        toastStore.show(t.toastNameSaved);
      }
    } finally {
      savingName.current = null;
    }
  };

  // ——— Письма ———

  const saveSettings = async (
    patch: { digest?: boolean; news?: boolean },
    withUndo = true,
  ) => {
    // Откат — только того, что меняли.
    const previous: { digest?: boolean; news?: boolean } = {};
    if (patch.digest !== undefined) previous.digest = me.digest;
    if (patch.news !== undefined) previous.news = me.news;
    update((m) => ({ ...m, ...patch }));
    const reply = await cabinetApi.profile(patch);
    if (!reply.ok || reply.data === null) {
      update((m) => ({ ...m, ...previous }));
      toastStore.show(t[messageOf(reply.code)]);
      return;
    }
    const saved = reply.data;
    update((m) => ({ ...m, digest: saved.digest, news: saved.news }));
    if (withUndo) {
      toastStore.show(t.toastSettingsSaved, {
        label: t.undo,
        run: () => void saveSettings(previous, false),
      });
    }
  };

  // ——— Почта ———

  const requestEmail = () =>
    run(async () => {
      const address = normalEmail(newEmail);
      const problems: Errors = {};
      if (!validEmail(address)) problems.email = "authErrorEmail";
      if (current === "") problems.password = "authErrorPasswordEmpty";
      if (problems.email !== undefined || problems.password !== undefined) {
        setErrors(problems);
        return;
      }
      const reply = await cabinetApi.requestEmail(address, current, lang);
      if (reply.ok) {
        setNewEmail(address);
        setCode("");
        setSentAt(Date.now());
        setNow(Date.now());
        setErrors({});
        setDialog("email-code");
        return;
      }
      if (reply.code === "EMAIL_TAKEN") {
        setErrors({ email: "cabinetErrorEmailTaken" });
      } else if (reply.code === "SAME_EMAIL") {
        setErrors({ email: "cabinetErrorSameEmail" });
      } else if (reply.code === "INVALID_EMAIL") {
        setErrors({ email: "authErrorEmail" });
      } else {
        fail(passwordFailure(reply));
      }
    });

  const resendEmail = () =>
    run(async () => {
      const reply = await cabinetApi.requestEmail(newEmail, current, lang);
      if (reply.ok) {
        setSentAt(Date.now());
        setNow(Date.now());
        setCode("");
        setErrors({});
        return;
      }
      setErrors({ form: messageOf(reply.code) });
    });

  const confirmEmail = () =>
    run(async () => {
      if (code.length !== 6) {
        setErrors({ code: "authErrorCodeIncomplete" });
        return;
      }
      const reply = await cabinetApi.confirmEmail(newEmail, code);
      if (reply.ok) {
        open(null);
        patchUser({ email: newEmail });
        await reload();
        toastStore.show(t.toastEmailChanged);
        return;
      }
      setErrors(
        ["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(reply.code)
          ? { code: messageOf(reply.code) }
          : { form: messageOf(reply.code) },
      );
    });

  // ——— Пароль ———

  const changePassword = () =>
    run(async () => {
      const problems: Errors = {};
      if (current === "") problems.password = "authErrorPasswordEmpty";
      if (next.length < PASSWORD.min || next.length > PASSWORD.max) {
        problems.next = "authErrorPasswordLength";
      }
      if (problems.password !== undefined || problems.next !== undefined) {
        setErrors(problems);
        return;
      }
      const reply = await cabinetApi.changePassword(current, next);
      if (reply.ok) {
        open(null);
        await reload();
        toastStore.show(t.toastPasswordUpdated);
        return;
      }
      if (["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG"].includes(reply.code)) {
        setErrors({ next: "authErrorPasswordLength" });
      } else {
        fail(passwordFailure(reply));
      }
    });

  /** Пароль задаётся восстановлением по коду на почту — окно входа (lib/account.ts, openAuth). */
  const setPassword = (from?: HTMLElement) => {
    const back = from ?? opener.current ?? undefined;
    open(null);
    openAuth("reset", { email: me.email, ...(back ? { opener: back } : {}) });
  };

  // ——— Google ———

  const connectGoogle = () =>
    run(async () => {
      const reply = await cabinetApi.linkGoogle(linkUrls(location.href));
      const url = reply.data?.url;
      if (reply.ok && typeof url === "string" && url.startsWith("https://")) {
        location.assign(url);
        return;
      }
      toastStore.show(t.cabinetErrorGoogle);
    });

  const disconnectGoogle = () =>
    run(async () => {
      const reply = await cabinetApi.disconnectGoogle();
      if (reply.ok) {
        open(null);
        await reload();
        toastStore.show(t.toastGoogleDisconnected);
        return;
      }
      fail(passwordFailure(reply));
    });

  // ——— Удаление ———

  const deleteAccount = () =>
    run(async () => {
      const problems: Errors = {};
      if (normalEmail(typed) !== me.email.toLowerCase()) {
        problems.email = "cabinetErrorMismatch";
      }
      if (current === "") problems.password = "authErrorPasswordEmpty";
      if (problems.email !== undefined || problems.password !== undefined) {
        setErrors(problems);
        return;
      }
      const reply = await cabinetApi.deleteAccount(typed, current);
      if (reply.ok) {
        open(null);
        forgetSession();
        toastStore.show(t.toastAccountDeleted);
        router.push(href(lang, "/"));
        return;
      }
      if (reply.code === "EMAIL_MISMATCH") {
        setErrors({ email: "cabinetErrorMismatch" });
      } else {
        fail(passwordFailure(reply));
      }
    });

  const wait = secondsLeft(sentAt, now);
  const formError =
    errors.form === undefined ? null : (
      <p className="auth-note auth-note-error" role="alert">
        {t[errors.form]}
      </p>
    );
  const strong = (text: string) => (
    <strong className="auth-email">{text}</strong>
  );
  const changed = changedAgo(me.password.changedAt, Date.now(), lang);

  return (
    <div className="cabinet">
      <Row id={ids.profile} title={t.rowProfile} text={t.rowProfileText}>
        <div className="cabinet-photo">
          {me.photo === null ? (
            <span className="cabinet-avatar" aria-hidden="true">
              {initialOf(me)}
            </span>
          ) : (
            // biome-ignore lint/performance/noImgElement: фото отдаёт сервис аккаунтов, next/image ему не нужен
            <img
              src={photoUrl(me.photo)}
              alt={t.photoAlt}
              width={64}
              height={64}
              className="cabinet-avatar"
            />
          )}
          <div className="cabinet-photo-actions">
            <div className="cabinet-buttons">
              <button
                type="button"
                className="cabinet-secondary"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  fileInput.current?.click();
                }}
              >
                {t.uploadPhoto}
              </button>
              {me.photo === null ? null : (
                <button
                  type="button"
                  className="cabinet-ghost"
                  aria-disabled={busy ? "true" : undefined}
                  onClick={() => void removePhoto()}
                >
                  {t.removePhoto}
                </button>
              )}
            </div>
            <p
              className={photoError ? "auth-note auth-note-error" : "auth-note"}
              role={photoError ? "alert" : undefined}
            >
              {photoError ? t.cabinetErrorPhoto : t.photoHint}
            </p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            className="cabinet-file"
            onChange={(e) => {
              void pickFile(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </div>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void saveName(name);
          }}
        >
          <Field
            t={t}
            id={ids.name}
            label={t.displayName}
            value={name}
            onChange={(value) => {
              setName(value);
              setNameError(undefined);
            }}
            onBlur={() => void saveName(name)}
            autoComplete="name"
            maxLength={64}
            error={nameError}
          />
        </form>
      </Row>

      <Row id={ids.email} title={t.rowEmail} text={t.rowEmailText}>
        <div className="cabinet-value">
          <Icon icon="material-symbols:mail-outline" className="cabinet-icon" />
          <div className="cabinet-text">
            <span className="cabinet-main">{me.email}</span>
            <span className="cabinet-hint">
              {me.emailVerified ? t.emailVerified : t.emailNotVerified}
            </span>
          </div>
          <button
            type="button"
            className="cabinet-secondary"
            onClick={(e) => {
              setNewEmail("");
              open(me.password.set ? "email" : "set-first", e.currentTarget);
            }}
          >
            {t.changeEmail}
          </button>
        </div>
      </Row>

      <Row id={ids.password} title={t.rowPassword} text={t.rowPasswordText}>
        <div className="cabinet-value">
          <Icon icon="material-symbols:lock-outline" className="cabinet-icon" />
          <div className="cabinet-text">
            {me.password.set ? (
              <>
                <span className="cabinet-main" aria-hidden="true">
                  ••••••••••••
                </span>
                <span className="cabinet-hint">
                  {t.passwordChanged.replace("{time}", changed)}
                </span>
              </>
            ) : (
              <span className="cabinet-hint">{t.passwordNotSet}</span>
            )}
          </div>
          <button
            type="button"
            className="cabinet-secondary"
            onClick={(e) =>
              me.password.set
                ? open("password", e.currentTarget)
                : setPassword(e.currentTarget)
            }
          >
            {me.password.set ? t.changePassword : t.setPassword}
          </button>
        </div>
      </Row>

      <Row id={ids.signIn} title={t.rowSignIn} text={t.rowSignInText}>
        <div className="cabinet-value">
          <span className="cabinet-icon">
            <GoogleLogo />
          </span>
          <div className="cabinet-text">
            <span className="cabinet-main">Google</span>
            <span className="cabinet-hint">
              {me.google
                ? t.googleConnected.replace("{email}", me.email)
                : t.googleNotConnected}
            </span>
          </div>
          {me.google ? (
            <button
              type="button"
              className="cabinet-outline"
              onClick={(e) =>
                open(
                  me.password.set ? "disconnect" : "set-first",
                  e.currentTarget,
                )
              }
            >
              {t.disconnect}
            </button>
          ) : (
            <button
              type="button"
              className="cabinet-secondary"
              aria-disabled={busy ? "true" : undefined}
              onClick={() => void connectGoogle()}
            >
              {t.connect}
            </button>
          )}
        </div>
        <div className="cabinet-value">
          <Icon icon="material-symbols:mail-outline" className="cabinet-icon" />
          <div className="cabinet-text">
            <span className="cabinet-main">{t.emailAndPassword}</span>
            <span className="cabinet-hint">
              {me.password.set ? t.alwaysAvailable : t.setPasswordToUse}
            </span>
          </div>
        </div>
      </Row>

      <Row
        id={ids.notifications}
        title={t.rowNotifications}
        text={t.rowNotificationsText}
      >
        {(
          [
            ["digest", t.digestLabel, t.digestText],
            ["news", t.newsLabel, t.newsText],
          ] as const
        ).map(([field, label, text]) => (
          <div key={field} className="cabinet-toggle-row">
            <button
              type="button"
              role="switch"
              aria-checked={me[field]}
              aria-label={label}
              className="cabinet-toggle"
              data-field={field}
              onClick={() =>
                void saveSettings(
                  field === "digest"
                    ? { digest: !me.digest }
                    : { news: !me.news },
                )
              }
            >
              <span className="cabinet-knob" />
            </button>
            <div className="cabinet-text">
              <span className="cabinet-main">{label}</span>
              <span className="cabinet-hint">{text}</span>
            </div>
          </div>
        ))}
      </Row>

      <Row id={ids.remove} title={t.rowDelete} text={t.rowDeleteText}>
        <div>
          <button
            type="button"
            className="cabinet-danger-outline"
            onClick={(e) =>
              open(me.password.set ? "delete" : "set-first", e.currentTarget)
            }
          >
            {t.deleteAccount}
          </button>
        </div>
      </Row>

      <PhotoDialog
        lang={lang}
        opener={opener}
        image={image}
        open={dialog === "crop"}
        busy={busy}
        error={cropError}
        onClose={() => {
          open(null);
          dropImage();
        }}
        onSave={(blob) => void savePhoto(blob)}
      />

      {/* Почта — одно окно в два шага (кадры C2 и C3): новая почта с паролем → код с новой почты. */}
      <CabinetDialog
        lang={lang}
        opener={opener}
        name={dialog === "email-code" ? "email-code" : "email"}
        step={dialog === "email-code" ? "code" : "email"}
        open={dialog === "email" || dialog === "email-code"}
        onClose={() => open(null)}
        {...(dialog === "email-code"
          ? {
              back: () => {
                setErrors({});
                setDialog("email");
              },
              title: t.codeTitle,
              description: (
                <>
                  {t.codeSent}
                  {strong(newEmail)}.
                </>
              ),
              action: t.authConfirm,
              onSubmit: () => void confirmEmail(),
            }
          : {
              title: t.emailTitle,
              description: t.emailText,
              action: t.authSendCode,
              onSubmit: () => void requestEmail(),
            })}
        busy={busy}
      >
        {dialog === "email-code" ? (
          <>
            <CodeField
              t={t}
              value={code}
              onChange={(value) => {
                setCode(value);
                setErrors({});
              }}
              error={errors.code}
            />
            {formError}
            <p className="auth-resend">
              {wait > 0 ? (
                t.resendIn.replace(
                  "{time}",
                  clock(Math.min(wait, RESEND_SECONDS - 1)),
                )
              ) : (
                <>
                  {t.noCode}{" "}
                  <button
                    type="button"
                    className="auth-link"
                    aria-disabled={busy ? "true" : undefined}
                    onClick={() => void resendEmail()}
                  >
                    {t.resend}
                  </button>
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <Field
              t={t}
              id={ids.newEmail}
              label={t.newEmail}
              type="email"
              value={newEmail}
              onChange={(value) => {
                setNewEmail(value);
                setErrors((prev) => ({
                  ...prev,
                  email: undefined,
                  form: undefined,
                }));
              }}
              autoComplete="email"
              error={errors.email}
            />
            <PasswordField
              t={t}
              id={ids.currentEmail}
              label={t.currentPassword}
              value={current}
              onChange={(value) => {
                setCurrent(value);
                setErrors((prev) => ({
                  ...prev,
                  password: undefined,
                  form: undefined,
                }));
              }}
              autoComplete="current-password"
              error={errors.password}
            />
            {formError}
          </>
        )}
      </CabinetDialog>

      <CabinetDialog
        lang={lang}
        opener={opener}
        name="password"
        open={dialog === "password"}
        onClose={() => open(null)}
        title={t.passwordTitle}
        description={t.passwordText}
        action={t.authSavePassword}
        busy={busy}
        onSubmit={() => void changePassword()}
      >
        <input
          className="sr-only"
          type="email"
          autoComplete="username"
          value={me.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <PasswordField
          t={t}
          id={ids.currentPassword}
          label={t.currentPassword}
          value={current}
          onChange={(value) => {
            setCurrent(value);
            setErrors((prev) => ({
              ...prev,
              password: undefined,
              form: undefined,
            }));
          }}
          autoComplete="current-password"
          error={errors.password}
        />
        <button
          type="button"
          className="auth-link auth-forgot"
          onClick={() => setPassword()}
        >
          {t.authForgot}
        </button>
        <PasswordField
          t={t}
          id={ids.next}
          label={t.authNewPassword}
          value={next}
          onChange={(value) => {
            setNext(value);
            setErrors((prev) => ({
              ...prev,
              next: undefined,
              form: undefined,
            }));
          }}
          autoComplete="new-password"
          error={errors.next}
        />
        {formError}
      </CabinetDialog>

      <CabinetDialog
        lang={lang}
        opener={opener}
        name="disconnect"
        open={dialog === "disconnect"}
        onClose={() => open(null)}
        title={t.disconnectTitle}
        description={
          <>
            {t.disconnectBefore}
            {strong(me.email)}
            {t.disconnectAfter}
          </>
        }
        action={t.disconnect}
        busy={busy}
        onSubmit={() => void disconnectGoogle()}
      >
        {formError}
      </CabinetDialog>

      <CabinetDialog
        lang={lang}
        opener={opener}
        name="set-first"
        open={dialog === "set-first"}
        onClose={() => open(null)}
        title={t.setFirstTitle}
        description={t.setFirstText}
        action={t.setPassword}
        onSubmit={() => setPassword()}
      />

      <CabinetDialog
        lang={lang}
        opener={opener}
        name="delete"
        open={dialog === "delete"}
        onClose={() => open(null)}
        title={t.deleteTitle}
        description={t.deleteText}
        action={t.deleteAccount}
        danger
        busy={busy}
        onSubmit={() => void deleteAccount()}
      >
        <p className="cabinet-instruction">
          {t.deleteTypeBefore}
          {strong(me.email)}
          {t.deleteTypeAfter}
        </p>
        <Field
          t={t}
          id={ids.confirm}
          label={t.authEmail}
          type="email"
          value={typed}
          onChange={(value) => {
            setTyped(value);
            setErrors((prev) => ({
              ...prev,
              email: undefined,
              form: undefined,
            }));
          }}
          autoComplete="off"
          error={errors.email}
        />
        <PasswordField
          t={t}
          id={ids.currentDelete}
          label={t.authPassword}
          value={current}
          onChange={(value) => {
            setCurrent(value);
            setErrors((prev) => ({
              ...prev,
              password: undefined,
              form: undefined,
            }));
          }}
          autoComplete="current-password"
          error={errors.password}
        />
        {formError}
      </CabinetDialog>
    </div>
  );
}
