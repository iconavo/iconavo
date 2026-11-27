"use client";

import { Icon } from "@iconavo-ui/react";
import { DropdownMenu as Primitive } from "radix-ui";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import type { MessageKey } from "../../lib/account";
import { useSession } from "../../lib/account";
import { getSets, orderSets } from "../../lib/catalog";
import {
  browserOf,
  FEEDBACK_LIMITS,
  type FeedbackField,
  type FeedbackKind,
  feedbackApi,
  feedbackErrorOf,
  feedbackPanelStore,
  pageOf,
  SCREENSHOT,
  screenshotProblem,
  useFeedbackRequest,
} from "../../lib/feedback";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { usePanelOpen } from "../../lib/panel-store";
import { toastStore } from "../../lib/toast";
import { CabinetDialog } from "./CabinetDialog";
import { Field, TextArea } from "./fields";

type Errors = Partial<Record<FeedbackField | "form", MessageKey>>;

const TITLES: Record<FeedbackKind, MessageKey> = {
  bug: "feedbackBugTitle",
  icons: "feedbackIconsTitle",
  feature: "feedbackFeatureTitle",
  feedback: "feedbackTitle",
};
const TEXTS: Record<FeedbackKind, MessageKey> = {
  bug: "feedbackBugText",
  icons: "feedbackIconsText",
  feature: "feedbackFeatureText",
  feedback: "feedbackText",
};
const ACTIONS: Record<FeedbackKind, MessageKey> = {
  bug: "feedbackSendReport",
  icons: "feedbackSendRequest",
  feature: "feedbackSendRequest",
  feedback: "feedbackSend",
};
const THANKS: Record<FeedbackKind, MessageKey> = {
  bug: "feedbackSentReport",
  icons: "feedbackSentRequest",
  feature: "feedbackSentRequest",
  feedback: "feedbackSentFeedback",
};

/**
 * Окна обратной связи (кадры K2–K6 макета «Личный кабинет») — из меню аккаунта, отдельным куском сборки,
 * как окно входа. Оболочка — окно кабинета (CabinetDialog): 440 px, «Cancel» и главная кнопка, на телефоне —
 * шторка. После отправки — сообщение «Thanks! We got your report» (K3).
 */
export default function FeedbackDialog({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const open = usePanelOpen(feedbackPanelStore);
  const request = useFeedbackRequest();
  const session = useSession();
  const kind = request.kind;
  const opener = useRef<HTMLElement | null>(null);
  const ids = {
    text: useId(),
    icons: useId(),
    use: useId(),
    feature: useId(),
    why: useId(),
    better: useId(),
  };
  const [text, setText] = useState("");
  const [icons, setIcons] = useState("");
  const [family, setFamily] = useState("");
  const [use, setUse] = useState("");
  const [feature, setFeature] = useState("");
  const [why, setWhy] = useState("");
  const [rating, setRating] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  // Новое открытие — поля с чистого листа, фокус потом — на кнопку, которая открыла окно.
  // biome-ignore lint/correctness/useExhaustiveDependencies: только при новом открытии
  useEffect(() => {
    opener.current = request.opener;
    setText("");
    setIcons("");
    setFamily("");
    setUse("");
    setFeature("");
    setWhy("");
    setRating(0);
    setFile(null);
    setErrors({});
  }, [request.serial]);

  const clear = (field: keyof Errors) =>
    setErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }));

  async function send() {
    if (working.current) return;
    const problems: Errors = {};
    if (kind === "bug" && text.trim() === "") {
      problems.text = "feedbackErrorText";
    }
    if (kind === "icons" && icons.trim() === "") {
      problems.icons = "feedbackErrorIcons";
    }
    if (kind === "feature" && feature.trim() === "") {
      problems.feature = "feedbackErrorFeature";
    }
    if (kind === "feedback" && rating === 0) {
      problems.rating = "feedbackErrorRating";
    }
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    const form = new FormData();
    form.set("kind", kind);
    if (kind === "bug") {
      form.set("text", text);
      form.set("page", pageOf(location.href));
      form.set("browser", browserOf(navigator.userAgent));
      if (file !== null) form.set("screenshot", file, file.name);
    } else if (kind === "icons") {
      form.set("icons", icons);
      if (family !== "") form.set("family", family);
      form.set("use", use);
    } else if (kind === "feature") {
      form.set("feature", feature);
      form.set("why", why);
    } else {
      form.set("rating", String(rating));
      form.set("text", text);
    }
    working.current = true;
    setBusy(true);
    try {
      const reply = await feedbackApi.send(form);
      if (reply.ok) {
        feedbackPanelStore.set(false);
        toastStore.show(t[THANKS[kind]], undefined, "success");
        return;
      }
      const error = feedbackErrorOf(reply.code);
      setErrors({ [error.field ?? "form"]: error.message });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const email = session.status === "signed-in" ? session.user.email : "";

  return (
    <CabinetDialog
      lang={lang}
      name={`feedback-${kind}`}
      open={open}
      onClose={() => feedbackPanelStore.set(false)}
      title={t[TITLES[kind]]}
      description={t[TEXTS[kind]]}
      action={t[ACTIONS[kind]]}
      busy={busy}
      onSubmit={() => void send()}
      opener={opener}
    >
      {kind === "bug" ? (
        <>
          <TextArea
            t={t}
            id={ids.text}
            label={t.feedbackBugField}
            value={text}
            maxLength={FEEDBACK_LIMITS.text}
            onChange={(value) => {
              setText(value);
              clear("text");
            }}
            error={errors.text}
          />
          <ScreenshotDrop
            lang={lang}
            file={file}
            error={errors.file}
            onFile={(next) => {
              setFile(next);
              clear("file");
            }}
            onProblem={() => setErrors({ file: "feedbackErrorFile" })}
          />
        </>
      ) : null}
      {kind === "icons" ? (
        <>
          <Field
            t={t}
            id={ids.icons}
            label={t.feedbackIconsField}
            value={icons}
            maxLength={FEEDBACK_LIMITS.short}
            autoComplete="off"
            onChange={(value) => {
              setIcons(value);
              clear("icons");
            }}
            error={errors.icons}
          />
          <FamilyMenu lang={lang} value={family} onChange={setFamily} />
          <TextArea
            t={t}
            id={ids.use}
            label={t.feedbackIconsUse}
            value={use}
            maxLength={FEEDBACK_LIMITS.text}
            onChange={setUse}
          />
        </>
      ) : null}
      {kind === "feature" ? (
        <>
          <Field
            t={t}
            id={ids.feature}
            label={t.feedbackFeatureField}
            value={feature}
            maxLength={FEEDBACK_LIMITS.short}
            autoComplete="off"
            onChange={(value) => {
              setFeature(value);
              clear("feature");
            }}
            error={errors.feature}
          />
          <TextArea
            t={t}
            id={ids.why}
            label={t.feedbackFeatureWhy}
            value={why}
            maxLength={FEEDBACK_LIMITS.text}
            onChange={setWhy}
          />
        </>
      ) : null}
      {kind === "feedback" ? (
        <>
          <Stars
            lang={lang}
            value={rating}
            error={errors.rating}
            onChange={(value) => {
              setRating(value);
              clear("rating");
            }}
          />
          <TextArea
            t={t}
            id={ids.better}
            label={t.feedbackBetter}
            value={text}
            maxLength={FEEDBACK_LIMITS.text}
            onChange={setText}
          />
        </>
      ) : null}
      {errors.form === undefined ? null : (
        <p className="auth-note auth-note-error" role="alert">
          {t[errors.form]}
        </p>
      )}
      {/* «We’ll reply to …» — только у ошибки, как в кадре K2; ответить владелец может на любое письмо. */}
      {kind !== "bug" || email === "" ? null : (
        <p className="auth-note">{t.feedbackReply.replace("{email}", email)}</p>
      )}
    </CabinetDialog>
  );
}

/**
 * «Add a screenshot» (кадр K2): пунктирная рамка, щелчок или перетаскивание файла; выбранный — имя и ✕.
 * Поле файла внутри подписи — до него доходят с клавиатуры.
 */
function ScreenshotDrop({
  lang,
  file,
  error,
  onFile,
  onProblem,
}: {
  lang: Lang;
  file: File | null;
  error?: MessageKey;
  onFile: (file: File | null) => void;
  onProblem: () => void;
}) {
  const t = DICTIONARIES[lang];
  const [over, setOver] = useState(false);
  const noteId = useId();
  const take = (next: File | undefined) => {
    if (next === undefined) return;
    if (screenshotProblem(next)) {
      onProblem();
      return;
    }
    onFile(next);
  };
  if (file !== null) {
    return (
      <div className="feedback-shot">
        <Icon
          icon="material-symbols:check-circle"
          className="feedback-shot-icon"
        />
        <span className="feedback-shot-name">{file.name}</span>
        <button
          type="button"
          className="feedback-shot-remove"
          aria-label={t.feedbackShotRemove}
          onClick={() => onFile(null)}
        >
          <Icon icon="material-symbols:close" />
        </button>
      </div>
    );
  }
  return (
    <div
      className="auth-input"
      data-invalid={error === undefined ? undefined : ""}
    >
      <label
        className="feedback-drop"
        data-over={over ? "" : undefined}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        <input
          type="file"
          className="feedback-drop-input"
          accept={SCREENSHOT.types.join(",")}
          aria-describedby={noteId}
          onChange={(e) => {
            take(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <Icon icon="material-symbols:upload" className="feedback-drop-icon" />
        <span className="feedback-drop-title">{t.feedbackShotAdd}</span>
        <span id={noteId} className="feedback-drop-hint">
          {t.feedbackShotHint}
        </span>
      </label>
      {error === undefined ? null : (
        <p className="auth-note auth-note-error" role="alert">
          {t[error]}
        </p>
      )}
    </div>
  );
}

/**
 * «Any family ▾» (кадр K4): поле-кнопка и меню наборов. Меню — внутри окна (portal в сам <dialog>): окно
 * модальное, и всё вне его неактивно. Esc закрывает только меню.
 */
function FamilyMenu({
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = DICTIONARIES[lang];
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    getSets().then(
      (all) => {
        if (!live) return;
        setSets(
          orderSets(Object.keys(all)).map((id) => ({
            id,
            name: all[id]?.name ?? id,
          })),
        );
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const current =
    value === ""
      ? t.feedbackAnyFamily
      : (sets.find((s) => s.id === value)?.name ?? value);

  return (
    <Primitive.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) setContainer(trigger.current?.closest("dialog") ?? null);
        setOpen(next);
      }}
    >
      <Primitive.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          className="feedback-select"
          aria-label={`${t.feedbackFamily}: ${current}`}
        >
          <span className="feedback-select-value">{current}</span>
          <Icon
            icon="material-symbols:keyboard-arrow-down"
            className="feedback-select-icon"
          />
        </button>
      </Primitive.Trigger>
      <Primitive.Portal container={container}>
        <Primitive.Content
          align="start"
          sideOffset={4}
          className="feedback-menu"
          aria-label={t.feedbackFamily}
          onEscapeKeyDown={(e) => {
            // Esc закрывает меню, а окно — нет: отменённое нажатие окно не закрывает.
            e.preventDefault();
            setOpen(false);
          }}
        >
          <Primitive.RadioGroup value={value} onValueChange={onChange}>
            {[{ id: "", name: t.feedbackAnyFamily }, ...sets].map((s) => (
              <Primitive.RadioItem
                key={s.id === "" ? "any" : s.id}
                value={s.id}
                className="feedback-menu-item"
              >
                <span className="feedback-menu-check">
                  <Primitive.ItemIndicator>
                    <Icon icon="material-symbols:check" />
                  </Primitive.ItemIndicator>
                </span>
                {s.name}
              </Primitive.RadioItem>
            ))}
          </Primitive.RadioGroup>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

/**
 * Звёзды (кадр K6): пять настоящих радиокнопок, скрытых за значками, — Tab попадает на выбранную, стрелки
 * меняют оценку, скринридер читает «4 of 5».
 */
function Stars({
  lang,
  value,
  error,
  onChange,
}: {
  lang: Lang;
  value: number;
  error?: MessageKey;
  onChange: (value: number) => void;
}) {
  const t = DICTIONARIES[lang];
  const name = useId();
  const noteId = useId();
  return (
    <div
      className="auth-input"
      data-invalid={error === undefined ? undefined : ""}
    >
      <fieldset
        className="feedback-stars"
        aria-describedby={error === undefined ? undefined : noteId}
      >
        <legend className="sr-only">{t.feedbackText}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="feedback-star"
            data-on={n <= value ? "" : undefined}
          >
            <input
              type="radio"
              name={name}
              value={n}
              className="sr-only"
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <Icon
              icon={
                n <= value
                  ? "material-symbols:star"
                  : "material-symbols:star-outline"
              }
            />
            <span className="sr-only">
              {t.feedbackStar.replace("{n}", String(n))}
            </span>
          </label>
        ))}
      </fieldset>
      {error === undefined ? null : (
        <p id={noteId} className="auth-note auth-note-error">
          {t[error]}
        </p>
      )}
    </div>
  );
}
