// Вход сборки для разработки — условие экспорта development (ADR-0031, ADR-0034): webpack 5 и Vite
// выбирают его сами, esbuild и Rollup — только с настройкой. Отличие от index.ts одно: режим
// разработки по умолчанию включён — пунктирная рамка у отсутствующей иконки.

import { define } from "./element.js";

export * from "@iconavo-ui/core";

define(true);
