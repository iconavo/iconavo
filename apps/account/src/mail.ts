// Письма сервиса (шаг 3 фазы 5, ADR-0055): коды регистрации и восстановления на английском и русском —
// языке страницы, с которой человек пришёл. Отправка — Cloudflare Email Service через привязку
// send_email (решение владельца 27 ноября 2026), без ключа; отправка — один модуль: сменить сервис —
// правка здесь. В журнал — только код ошибки, без адреса (ADR-0028).

import { CODE, type Locale, MAIL_FROM } from "./config.js";
import type { MailBinding, MailMessage } from "./env.js";

/** Зачем код: регистрация, новый пароль или новая почта (PR 4а). */
export type CodeKind = "sign-up" | "reset" | "email";

interface Texts {
  subject: (code: string) => string;
  title: string;
  lead: string;
  expires: string;
  ignore: string;
}

const MINUTES = CODE.ttlSeconds / 60;

const TEXTS: Record<Locale, Record<CodeKind, Texts>> = {
  en: {
    "sign-up": {
      subject: (code) => `${code} is your Iconavo sign-up code`,
      title: "Your sign-up code",
      lead: "Enter this code to create your Iconavo account:",
      expires: `The code works for ${MINUTES} minutes.`,
      ignore:
        "If you didn’t try to create an account, ignore this email: nothing will happen.",
    },
    email: {
      subject: (code) =>
        `${code} is your code to confirm your new Iconavo email`,
      title: "Confirm your new email",
      lead: "Enter this code to make this address the email of your Iconavo account:",
      expires: `The code works for ${MINUTES} minutes.`,
      ignore:
        "If you didn’t ask to change your email, ignore this email: nothing will change.",
    },
    reset: {
      subject: (code) => `${code} is your Iconavo password reset code`,
      title: "Your password reset code",
      lead: "Enter this code to set a new password for your Iconavo account:",
      expires: `The code works for ${MINUTES} minutes.`,
      ignore:
        "If you didn’t ask to reset your password, ignore this email: your password stays the same.",
    },
  },
  ru: {
    "sign-up": {
      subject: (code) => `${code} — код для регистрации в Iconavo`,
      title: "Код для регистрации",
      lead: "Введите этот код, чтобы создать аккаунт Iconavo:",
      expires: `Код действует ${MINUTES} минут.`,
      ignore:
        "Если вы не создавали аккаунт, просто не отвечайте на письмо: ничего не произойдёт.",
    },
    email: {
      subject: (code) => `${code} — код для новой почты Iconavo`,
      title: "Подтвердите новую почту",
      lead: "Введите этот код, чтобы этот адрес стал почтой аккаунта Iconavo:",
      expires: `Код действует ${MINUTES} минут.`,
      ignore:
        "Если вы не меняли почту, просто не отвечайте на письмо: ничего не изменится.",
    },
    reset: {
      subject: (code) => `${code} — код для нового пароля Iconavo`,
      title: "Код для нового пароля",
      lead: "Введите этот код, чтобы задать новый пароль аккаунта Iconavo:",
      expires: `Код действует ${MINUTES} минут.`,
      ignore:
        "Если вы не просили новый пароль, просто не отвечайте на письмо: пароль останется прежним.",
    },
  },
};

const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );

/** Письмо с кодом: HTML со встроенными стилями (почтовые программы не берут файлы стилей) и текст. */
export function codeMail(
  to: string,
  code: string,
  kind: CodeKind,
  locale: Locale,
): MailMessage {
  const t = TEXTS[locale][kind];
  const text = [t.title, "", t.lead, "", code, "", t.expires, t.ignore].join(
    "\n",
  );
  const html = `<!doctype html>
<html lang="${locale}">
<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto">
<p style="margin:0 0 24px;font-size:16px;font-weight:600">Iconavo</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600">${esc(t.title)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:24px">${esc(t.lead)}</p>
<p style="margin:0 0 16px;font-size:32px;line-height:40px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(code)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#555555">${esc(t.expires)}</p>
<p style="margin:0;font-size:14px;line-height:20px;color:#555555">${esc(t.ignore)}</p>
</div>
</body>
</html>`;
  return {
    from: { ...MAIL_FROM },
    to,
    subject: t.subject(code),
    html,
    text,
  };
}

/** Уведомление о перемене в аккаунте (решение 3 PR 4): почта — на прежний адрес, пароль — на почту аккаунта. */
export type NoticeKind = "email-changed" | "password-changed";

interface Notice {
  subject: string;
  title: string;
  lead: (to: string) => string;
  act: string;
}

const NOTICES: Record<Locale, Record<NoticeKind, Notice>> = {
  en: {
    "email-changed": {
      subject: "The email of your Iconavo account was changed",
      title: "Your email was changed",
      lead: (to) =>
        `The email of your Iconavo account is now ${to}. This address no longer logs in.`,
      act: "If it wasn’t you, reply to this email right away and we’ll help you get your account back.",
    },
    "password-changed": {
      subject: "The password of your Iconavo account was changed",
      title: "Your password was changed",
      lead: () => "The password of your Iconavo account was just changed.",
      act: "If it wasn’t you, reset your password at iconavo.dev with “Forgot your password?” and reply to this email.",
    },
  },
  ru: {
    "email-changed": {
      subject: "Почта аккаунта Iconavo изменена",
      title: "Почта изменена",
      lead: (to) =>
        `Почта вашего аккаунта Iconavo теперь — ${to}. Этим адресом войти больше нельзя.`,
      act: "Если это были не вы, сразу ответьте на это письмо — поможем вернуть аккаунт.",
    },
    "password-changed": {
      subject: "Пароль аккаунта Iconavo изменён",
      title: "Пароль изменён",
      lead: () => "Пароль вашего аккаунта Iconavo только что изменили.",
      act: "Если это были не вы, задайте новый пароль на iconavo.dev через «Забыли пароль?» и ответьте на это письмо.",
    },
  },
};

/** Почта наполовину скрыта: a***@example.com — в письме на прежний адрес. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** Уведомление: что случилось и что делать, если это были не вы. Ответ приходит на support@. */
export function noticeMail(
  to: string,
  kind: NoticeKind,
  locale: Locale,
  newEmail = "",
): MailMessage {
  const t = NOTICES[locale][kind];
  const lead = t.lead(maskEmail(newEmail));
  const text = [t.title, "", lead, "", t.act].join("\n");
  const html = `<!doctype html>
<html lang="${locale}">
<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto">
<p style="margin:0 0 24px;font-size:16px;font-weight:600">Iconavo</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600">${esc(t.title)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:24px">${esc(lead)}</p>
<p style="margin:0;font-size:14px;line-height:20px;color:#555555">${esc(t.act)}</p>
</div>
</body>
</html>`;
  return {
    from: { ...MAIL_FROM },
    to,
    subject: t.subject,
    html,
    text,
    replyTo: MAIL_FROM.email,
  };
}

/** Код ошибки отправки для журнала: без адреса и текста письма. */
const failureCode = (e: unknown): string => {
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : "unknown";
};

/** Отправить письмо; сбой — строка журнала с кодом ошибки, без адреса. Привязки нет — сбой тоже. */
export async function sendMail(
  binding: MailBinding | undefined,
  message: MailMessage,
  log: (line: string) => void,
): Promise<boolean> {
  if (binding === undefined) {
    log("аккаунты: письмо не ушло: нет привязки EMAIL");
    return false;
  }
  try {
    await binding.send(message);
    return true;
  } catch (e) {
    log(`аккаунты: письмо не ушло: ${failureCode(e)}`);
    return false;
  }
}
