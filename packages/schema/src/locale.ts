import { z } from "zod";

// Сообщения zod — по-русски: ошибки читает человек, а не программа.
const ru = z.locales.ru();

z.config({
  localeError: (issue) =>
    issue.code === "invalid_type" && issue.input === undefined
      ? "обязательное поле отсутствует"
      : ru.localeError(issue),
});
