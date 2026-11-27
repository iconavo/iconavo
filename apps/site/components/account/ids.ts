// id кнопок аккаунта в верхней полосе: туда возвращается фокус, когда кнопка, которая открыла окно или
// меню, сменилась (вошли — «Log In» стала аватаром, вышли — наоборот).

export const LOG_IN_BUTTON_ID = "account-log-in";
export const ACCOUNT_BUTTON_ID = "account-button";

/** Фокус — на кнопку аккаунта, какая она сейчас; после отрисовки. */
export function focusAccountButton(): void {
  requestAnimationFrame(() => {
    (
      document.getElementById(ACCOUNT_BUTTON_ID) ??
      document.getElementById(LOG_IN_BUTTON_ID)
    )?.focus();
  });
}
