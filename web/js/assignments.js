// The assignment form: which assignments exist, the deadline fields, the folder.
import { $, setStatus } from "./dom.js";
import { gh } from "./github.js";
import { hasClasses } from "./course.js";
import { session, target } from "./state.js";

const SKIP = new Set([".git", ".DS_Store", "__pycache__", ".pytest_cache", "node_modules"]);
export const MAX_BLOB = 10 * 1024 * 1024;

export async function loadAssignments() {
  const { org, repo, token } = target();
  session.assignments = [];
  try {
    const items = await gh(token, "GET", `/repos/${org}/${repo}/contents/assignments`);
    session.assignments = items.filter((i) => i.name.endsWith(".json")).map((i) => i.name.slice(0, -5)).sort();
  } catch (e) { if (e.status !== 404) return; }
  const sel = $("aCarry");
  sel.length = 1;
  for (const a of session.assignments) sel.add(new Option(a, a));
}

let softModeChosen = false;   // once someone picks, the page stops choosing for them

// A soft deadline in class weeks needs classes; without any, it's a date or none.
function refreshSoftModes() {
  const classes = hasClasses();
  const sel = $("aSoftMode");
  sel.options[0].disabled = !classes;
  if (!classes && sel.value === "week") sel.value = "date";
  else if (classes && !softModeChosen) sel.value = "week";
  $("aSoftWeekWrap").hidden = sel.value !== "week";
  $("aSoftDateWrap").hidden = sel.value !== "date";
}

// The folder's files, with paths inside it, minus what never belongs in a repo.
export function folderFiles() {
  return [...$("aFolder").files]
    .map((f) => ({ file: f, path: f.webkitRelativePath.split("/").slice(1).join("/") }))
    .filter(({ path }) => path && !path.split("/").some((p) => SKIP.has(p)));
}

export function initAssignmentForm() {
  document.addEventListener("classes-changed", refreshSoftModes);
  $("aSoftMode").addEventListener("change", () => { softModeChosen = true; refreshSoftModes(); });
  refreshSoftModes();
  $("aNoHard").addEventListener("change", () => { $("aHard").disabled = $("aNoHard").checked; });
  $("aFolder").addEventListener("change", () => {
    const files = folderFiles();
    const big = files.filter((f) => f.file.size > MAX_BLOB).length;
    setStatus("folderStatus", files.length
      ? `${files.length} files${big ? `, ${big} over 10 MB will be skipped` : ""}. ` +
        "Browsers don't pass on file permissions, so scripts arrive without their executable bit."
      : "", big ? "warn" : "");
  });
}
