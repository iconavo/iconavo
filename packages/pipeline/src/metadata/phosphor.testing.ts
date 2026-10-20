// Модуль dist/index.mjs в том виде, в каком его собирает Phosphor, но с другими именами переменных:
// разбор не должен зависеть от того, как сборщик назвал переменные.

export const PHOSPHOR_MODULE = `var x = /* @__PURE__ */ ((i) => (i.REGULAR = "regular", i.BOLD = "bold", i))(x || {}), cat = /* @__PURE__ */ ((i) => (i.ARROWS = "arrows", i.DEVELOPMENT = "technology & development", i))(cat || {}), fig = /* @__PURE__ */ ((i) => (i.ARROWS = "arrows", i))(fig || {});
const list = [
  {
    name: "acorn",
    pascal_name: "Acorn",
    categories: [cat.ARROWS, cat.DEVELOPMENT],
    figma_category: fig.ARROWS,
    tags: [
      "*new*",
      "savings",
      911
    ],
    codepoint: 58e3,
    published_in: 2.1,
    updated_in: 2.1
  },
  {
    name: "asclepius",
    pascal_name: "Asclepius",
    alias: { name: "caduceus", pascal_name: "Caduceus" },
    categories: [cat.ARROWS],
    figma_category: fig.ARROWS,
    tags: ["medicine"],
  },
];
export {
  fig as FigmaCategory,
  cat as IconCategory,
  x as IconStyle,
  list as icons
};
`;
