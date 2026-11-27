"use client";

import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import { DropdownMenu as Primitive } from "radix-ui";
import { Fragment, useRef, useState } from "react";
import {
  type AccountUser,
  initialOf,
  type MessageKey,
  signOut,
} from "../../lib/account";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { PHONE } from "../../lib/panel-store";
import { toastStore } from "../../lib/toast";
import { DropdownMenu, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { ACCOUNT_BUTTON_ID, focusAccountButton } from "./ids";

interface Item {
  id: string;
  icon: string;
  label: MessageKey;
  /** Ссылка; без неё — «Soon»: экрана ещё нет. */
  href?: string;
  /** Ссылка открывается в этой же вкладке (страница сайта), а не в новой. */
  same?: boolean;
  /** Черта перед пунктом. */
  separated?: boolean;
}

/**
 * Пункты меню аккаунта (кадр «A1 · Account / Account Menu»). Работают «My account» (страница /account,
 * PR 4), «Help center» (документация в новой вкладке) и «Log Out»; остальное — «Soon»: обратная связь —
 * PR 6, тарифы — фаза 8.
 */
const ITEMS: Item[] = [
  {
    id: "account",
    icon: "material-symbols:account-circle",
    label: "menuMyAccount",
    href: "/account",
    same: true,
  },
  { id: "plan", icon: "material-symbols:request-quote", label: "menuPlan" },
  {
    id: "help",
    icon: "material-symbols:support",
    label: "menuHelp",
    href: "/docs",
  },
  { id: "bug", icon: "material-symbols:bug-report", label: "menuBug" },
  {
    id: "icons",
    icon: "material-symbols:waving-hand",
    label: "menuRequestIcons",
    separated: true,
  },
  {
    id: "features",
    icon: "material-symbols:lightbulb",
    label: "menuRequestFeatures",
  },
  { id: "feedback", icon: "material-symbols:send", label: "menuFeedback" },
];

/**
 * Аватар: фото из кабинета (PR 4), без фото — первая буква имени или почты в круге (решение владельца
 * 27 ноября 2026). Фото отдаёт сервис аккаунтов — только самому человеку.
 */
export function Avatar({
  user,
  className = "top-circle account-avatar",
}: {
  user: AccountUser;
  className?: string;
}) {
  if (user.photo !== undefined) {
    return (
      // biome-ignore lint/performance/noImgElement: фото отдаёт сервис аккаунтов, next/image ему не нужен
      <img
        src={user.photo}
        alt=""
        width={28}
        height={28}
        className={`${className} account-photo`}
      />
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {initialOf(user)}
    </span>
  );
}

/**
 * Аватар и меню аккаунта: на компьютере — выпадающее меню Radix, всегда немодальное (ADR-0038), на
 * телефоне — шторка снизу (кадр «A1 · Account / Mobile — Account Menu»): родной <dialog>, ручка и
 * затемнение закрывают. Выход — сразу, без «Undo» (решение владельца 27 ноября 2026), затем сообщение
 * «You’re logged out» и фокус на «Log In».
 */
export function AccountMenu({ lang, user }: { lang: Lang; user: AccountUser }) {
  const t = DICTIONARIES[lang];
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);

  async function logOut() {
    sheet.current?.close();
    const ok = await signOut();
    toastStore.show(ok ? t.toastLoggedOut : t.authErrorLogOut);
    focusAccountButton();
  }

  const caption = (
    <span className="account-menu-caption">
      <span>{t.menuLoggedInAs}</span>
      <span className="account-menu-email">{user.email}</span>
    </span>
  );

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next && window.matchMedia(PHONE).matches) {
            sheet.current?.showModal();
            body.current?.focus();
            return;
          }
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            id={ACCOUNT_BUTTON_ID}
            className="topbar-account"
            aria-label={t.accountOf.replace("{email}", user.email)}
          >
            <Avatar user={user} />
            <Icon
              icon="material-symbols:keyboard-arrow-down"
              className="topbar-wide topbar-account-chevron"
            />
          </button>
        </DropdownMenuTrigger>
        <Primitive.Portal>
          <Primitive.Content
            align="end"
            sideOffset={8}
            className="account-menu"
            aria-label={t.account}
          >
            {ITEMS.map((item) => (
              <Fragment key={item.id}>
                {item.separated ? (
                  <Primitive.Separator className="account-menu-separator" />
                ) : null}
                {item.href === undefined ? (
                  <Primitive.Item disabled className="account-menu-item">
                    <Icon icon={item.icon} className="account-menu-icon" />
                    <span className="account-menu-label">{t[item.label]}</span>
                    <span className="account-menu-soon">{t.soon}</span>
                  </Primitive.Item>
                ) : (
                  <Primitive.Item asChild className="account-menu-item">
                    {item.same ? (
                      <Link href={href(lang, item.href)}>
                        <Icon icon={item.icon} className="account-menu-icon" />
                        <span className="account-menu-label">
                          {t[item.label]}
                        </span>
                      </Link>
                    ) : (
                      <a
                        href={href(lang, item.href)}
                        target="_blank"
                        rel="noopener"
                      >
                        <Icon icon={item.icon} className="account-menu-icon" />
                        <span className="account-menu-label">
                          {t[item.label]}
                          <span className="sr-only">{t.menuNewTab}</span>
                        </span>
                      </a>
                    )}
                  </Primitive.Item>
                )}
              </Fragment>
            ))}
            <Primitive.Separator className="account-menu-separator" />
            <Primitive.Item
              className="account-menu-item"
              onSelect={() => void logOut()}
            >
              <Icon
                icon="material-symbols:logout"
                className="account-menu-icon"
              />
              <span className="account-menu-label">{t.menuLogOut}</span>
            </Primitive.Item>
            {caption}
          </Primitive.Content>
        </Primitive.Portal>
      </DropdownMenu>
      {/* Щелчок мимо шторки попадает в сам <dialog> (его ::backdrop) — закрыть. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: с клавиатуры шторку закрывают Esc и ручка-кнопка */}
      <dialog
        ref={sheet}
        className="ip-sheet account-sheet"
        aria-label={t.account}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div ref={body} className="ip-sheet-body" tabIndex={-1}>
          <button
            type="button"
            className="account-sheet-grabber"
            aria-label={t.panelClose}
            onClick={() => sheet.current?.close()}
          >
            <span className="ip-sheet-handle" />
          </button>
          <ul className="account-sheet-list">
            {ITEMS.map((item) => (
              <li
                key={item.id}
                className={
                  item.separated ? "account-sheet-separated" : undefined
                }
              >
                {item.href === undefined ? (
                  <button
                    type="button"
                    className="account-menu-item"
                    aria-disabled="true"
                  >
                    <Icon icon={item.icon} className="account-menu-icon" />
                    <span className="account-menu-label">{t[item.label]}</span>
                    <span className="account-menu-soon">{t.soon}</span>
                  </button>
                ) : (
                  <Link
                    className="account-menu-item"
                    href={href(lang, item.href)}
                    {...(item.same
                      ? {}
                      : { target: "_blank", rel: "noopener" })}
                    onClick={() => sheet.current?.close()}
                  >
                    <Icon icon={item.icon} className="account-menu-icon" />
                    <span className="account-menu-label">
                      {t[item.label]}
                      {item.same ? null : (
                        <span className="sr-only">{t.menuNewTab}</span>
                      )}
                    </span>
                  </Link>
                )}
              </li>
            ))}
            <li className="account-sheet-separated">
              <button
                type="button"
                className="account-menu-item"
                onClick={() => void logOut()}
              >
                <Icon
                  icon="material-symbols:logout"
                  className="account-menu-icon"
                />
                <span className="account-menu-label">{t.menuLogOut}</span>
              </button>
              {caption}
            </li>
          </ul>
        </div>
      </dialog>
    </>
  );
}
