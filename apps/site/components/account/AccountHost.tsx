"use client";

import { Icon } from "@iconavo-ui/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { authPanelStore, startAccount } from "../../lib/account";
import { feedbackPanelStore } from "../../lib/feedback";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { usePanelOpen } from "../../lib/panel-store";
import { TOAST_MS, toastStore, useToast } from "../../lib/toast";
import { loadAuthDialog, loadFeedbackDialog } from "./load";

const AuthDialog = lazy(loadAuthDialog);
const FeedbackDialog = lazy(loadFeedbackDialog);

/**
 * Аккаунт на странице (шаг 3 фазы 5, PR 3): начало (lib/account.ts — ?accounts=, кто вошёл, возврат после
 * Google), окно входа — отдельным куском сборки, только после первого открытия, и всплывающее сообщение.
 */
export function AccountHost({ lang }: { lang: Lang }) {
  const open = usePanelOpen(authPanelStore);
  const [loaded, setLoaded] = useState(false);

  // Возврат после подключения Google в кабинете — сообщением (PR 4).
  useEffect(
    () =>
      startAccount((kind, code) => {
        const t = DICTIONARIES[lang];
        toastStore.show(
          kind === "linked"
            ? t.toastGoogleConnected
            : /email/i.test(code)
              ? t.cabinetErrorGoogleEmail
              : t.cabinetErrorGoogle,
        );
      }),
    [lang],
  );

  useEffect(() => {
    if (open) setLoaded(true);
  }, [open]);

  // Обратная связь (PR 6а): окно грузится при первом открытии из меню аккаунта.
  const feedbackOpen = usePanelOpen(feedbackPanelStore);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  useEffect(() => {
    if (feedbackOpen) setFeedbackLoaded(true);
  }, [feedbackOpen]);

  return (
    <>
      <ToastView lang={lang} />
      {loaded ? (
        <Suspense fallback={null}>
          <AuthDialog lang={lang} />
        </Suspense>
      ) : null}
      {feedbackLoaded ? (
        <Suspense fallback={null}>
          <FeedbackDialog lang={lang} />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * Сообщение (кадр «L2 · Log Out / Logged Out»): справа сверху под верхней полосой, значок, текст и ✕;
 * уходит само через 5 секунд. Область role="status" на странице всегда — скринридер читает новый текст.
 */
function ToastView({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const toast = useToast();

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => toastStore.hide(toast.serial), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-region" role="status">
      {toast === null ? null : (
        <div className="toast" key={toast.serial}>
          <Icon
            icon={
              toast.tone === "success"
                ? "material-symbols:check-circle"
                : "material-symbols:info"
            }
            className={
              toast.tone === "success"
                ? "toast-icon toast-success"
                : "toast-icon"
            }
          />
          <span className="toast-text">{toast.text}</span>
          {toast.action === undefined ? null : (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.run();
                toastStore.hide(toast.serial);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label={t.toastClose}
            onClick={() => toastStore.hide()}
          >
            <Icon icon="material-symbols:close" />
          </button>
        </div>
      )}
    </div>
  );
}
