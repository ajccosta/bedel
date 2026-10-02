// What every page has: the theme switch, and links to the bedel repository
// the page was made from.
import { $ } from "./dom.js";
import { TEMPLATE } from "./github.js";

export function initPage() {
  for (const a of document.querySelectorAll("a[data-template]")) {
    a.href = `https://github.com/${TEMPLATE}${a.dataset.template}`;
    if (a.dataset.label !== undefined) a.textContent = `github.com/${TEMPLATE}`;
  }
  $("themeBtn").onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark"
                                    : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
  };
}
