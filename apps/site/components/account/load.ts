// Окно входа — отдельным куском сборки: его код нужен только тем, кто входит. Кнопки «Log In» начинают
// загрузку заранее — при наведении и фокусе.

export const loadAuthDialog = () => import("./AuthDialog");

/** Окна обратной связи (PR 6а) — тоже отдельным куском: открывают их из меню аккаунта. */
export const loadFeedbackDialog = () => import("./FeedbackDialog");

export function preloadAuthDialog(): void {
  void loadAuthDialog().catch(() => {});
}
