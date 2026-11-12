// Меню-шторка на телефоне (макет «Icon Sets / Mobile — Menu»): та же боковая панель поверх страницы.
// Открыта — атрибут data-menu="open" у <html>: по нему CSS показывает панель и затемнение. Шторка
// немодальная и без Radix Dialog: модальные компоненты Radix вставляют <style>, а CSP сайта пускает стили
// только файлами (ADR-0038).

const listeners = new Set<() => void>();

export const MENU_BUTTON_ID = "menu-button";
export const MENU_CLOSE_ID = "menu-close";

export const menuStore = {
  get(): boolean {
    return document.documentElement.dataset.menu === "open";
  },
  set(open: boolean) {
    const root = document.documentElement;
    if (open === (root.dataset.menu === "open")) return;
    if (open) root.dataset.menu = "open";
    else delete root.dataset.menu;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
