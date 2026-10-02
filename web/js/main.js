// The setup page: wires the modules to the page.
import { $, setStatus, runButton } from "./dom.js";
import { TEMPLATE, b64FromText, textFromB64, sodium } from "./github.js";
import { SETUP_PERMISSIONS, BOT_PERMISSIONS, tokenUrl } from "./tokens.js";
import { initCourseForm, readCourse, fillCourse } from "./course.js";
import { readText, parseRoster, parseListing, mergeListings } from "./students.js";
import { students } from "./state.js";
import { checkSetup, runSetup } from "./setup.js";
import { initAssignmentForm } from "./assignments.js";
import { release } from "./release.js";

for (const id of ["repoLink", "codeLink", "footRepo"]) $(id).href = `https://github.com/${TEMPLATE}`;
$("footRepo").textContent = `github.com/${TEMPLATE}`;
$("footDocs").href = `https://github.com/${TEMPLATE}/blob/main/scripts/README.md`;

$("themeBtn").onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark"
                                  : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
};

// ---------- token links ----------
function refreshLinks() {
  const org = $("org").value.trim();
  const days = Math.min(366, Math.max(1, parseInt($("botDays").value, 10) || 180));
  $("setupTokenLink").href = tokenUrl(org, `bedel setup (${org || "course"})`,
    "Used by the bedel setup page to set up the course", 7, SETUP_PERMISSIONS);
  $("botTokenLink").href = tokenUrl(org, `bedel bot (${org || "course"})`,
    "Creates the course's teams and repos, and locks them at deadlines", days, BOT_PERMISSIONS);
}
$("org").addEventListener("input", refreshLinks);
$("botDays").addEventListener("input", refreshLinks);
refreshLinks();

// ---------- student files: read here, never uploaded ----------
async function onRoster(column) {
  const file = $("roster").files[0];
  students.roster = null;
  if (!file) { setStatus("rosterStatus", ""); $("colWrap").hidden = true; return; }
  try {
    if (!column) students.rosterText = await readText(file);
    const res = parseRoster(students.rosterText, column);
    if (res.headers) {
      const sel = $("rosterCol");
      sel.length = 0;
      sel.add(new Option("Choose…", ""));
      for (const h of res.headers) sel.add(new Option(h, h));
      $("colWrap").hidden = false;
      setStatus("rosterStatus", "Which column holds the student numbers?", "warn");
      return;
    }
    if (!res.numbers.length) throw new Error("No student numbers found in that column.");
    students.roster = res.numbers;
    setStatus("rosterStatus", `${res.numbers.length} student numbers found. Only these numbers will be sent.`, "ok");
  } catch (e) { setStatus("rosterStatus", e.message, "bad"); }
}
$("roster").addEventListener("change", () => { $("colWrap").hidden = true; onRoster(); });
$("rosterCol").addEventListener("change", (e) => e.target.value && onRoster(e.target.value));

$("listings").addEventListener("change", async () => {
  students.classes = null;
  const files = [...$("listings").files];
  if (!files.length) { setStatus("listingStatus", ""); return; }
  try {
    const listings = [];
    for (const f of files) listings.push(parseListing(f.name, await readText(f)));
    const { pairs, counts, twice } = mergeListings(listings);
    students.classes = pairs;
    const summary = Object.entries(counts).sort().map(([c, k]) => `${c}: ${k}`).join(", ");
    setStatus("listingStatus", `${pairs.length} students across ${Object.keys(counts).length} classes (${summary}).` +
      (twice ? ` ${twice} listed twice, first class kept.` : ""), twice ? "warn" : "ok");
  } catch (e) { setStatus("listingStatus", e.message, "bad"); }
});

// ---------- the forms and buttons ----------
initAssignmentForm();   // first, so it hears every change the course form makes
initCourseForm();

$("checkSetup").onclick = async () => {
  setStatus("setupStatus", "Checking…");
  try { setStatus("setupStatus", await checkSetup(), "ok"); }
  catch (e) { setStatus("setupStatus", e.message, "bad"); }
};
runButton("runSetup", "setupLog", runSetup);
runButton("runRelease", "releaseLog", release);

// For the page's own tests: the pure parts, without a network.
window.bedel = { parseRoster, parseListing, mergeListings, tokenUrl, readCourse, fillCourse,
                 b64FromText, textFromB64, sodium, SETUP_PERMISSIONS, BOT_PERMISSIONS };
