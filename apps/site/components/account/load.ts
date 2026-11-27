// Окно входа — отдельным куском сборки: его код нужен только тем, кто входит. Кнопки «Log In» начинают
// загрузку заранее — при наведении и фокусе.

export const loadAuthDialog = () => import("./AuthDialog");

export function preloadAuthDialog(): void {
  void loadAuthDialog().catch(() => {});
}
