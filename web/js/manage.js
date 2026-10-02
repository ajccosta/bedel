// A course's own page: what's happening, read without a token, and changes,
// made with a token from an owner of the course's organization.
import { $, setStatus, logger, runButton } from "./dom.js";
import { initPage } from "./page.js";
import { gh, GitHubError } from "./github.js";
import { COURSE_PERMISSIONS, BOT_PERMISSIONS, tokenUrl, checkToken } from "./tokens.js";
import { initCourseForm, readCourse, fillCourse } from "./course.js";
import { initStudentInputs } from "./students.js";
import { initAssignmentForm, loadAssignments } from "./assignments.js";
import { release } from "./release.js";
import { ctx, session, students } from "./state.js";
import * as ops from "./ops.js";

const REPO_RE = /^[A-Za-z0-9-]+\/[\w.-]+$/;
let course = null;

// Which course: ?repo=ORG/REPO, or the repository this copy of the page was
// published from (site.json, written by .github/workflows/pages.yml).
async function whichRepo() {
  const asked = new URLSearchParams(location.search).get("repo");
  if (asked && REPO_RE.test(asked)) return asked;
  try {
    const r = await fetch("site.json", { cache: "no-store" });
    if (r.ok) {
      const site = await r.json();
      if (!site.template && REPO_RE.test(site.repo || "")) return site.repo;
    }
  } catch { /* not published by the workflow: ask */ }
  return null;
}

// ---------- reading: no token needed, the course repository is public ----------
const ago = (iso) => {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, n] of [["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
  }
  return "just now";
};
const when = (iso) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium", timeStyle: "short", timeZone: course?.timezone || undefined,
}).format(new Date(iso));

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function linkTo(href, text) { const a = el("a", text); a.href = href; return a; }

async function loadOverview() {
  const { org, repo, token } = ctx;
  const t = token || null;
  const info = await gh(t, "GET", `/repos/${org}/${repo}`);
  ctx.org = info.owner.login; ctx.repo = info.name;
  session.branch = info.default_branch || "main";
  course = await ops.readCourseFile(t, ctx.org, ctx.repo);
  const base = `https://github.com/${ctx.org}/${ctx.repo}`;

  $("courseName").textContent = course?.name || `${ctx.org}/${ctx.repo}`;
  document.title = `${course?.name || ctx.repo} — bedel`;
  const meta = $("courseMeta");
  meta.textContent = "";
  meta.append(linkTo(base, `${ctx.org}/${ctx.repo}`));
  if (course) {
    const { min, max } = course.group_size;
    const classes = Object.keys(course.classes || {});
    meta.append(` · groups of ${min === max ? min : `${min} to ${max}`} · ${course.timezone} · ` +
      (classes.length ? `classes ${classes.join(", ")}` : "no classes"));
  } else {
    meta.append(" · not set up yet: there's no course.json. Set it up from bedel's setup page.");
  }
  $("studentLink").value = `${base}/issues/new?template=register.yml`;
  for (const e of document.querySelectorAll(".orgname")) e.textContent = ctx.org;
  for (const e of document.querySelectorAll(".reponame")) e.textContent = `${ctx.org}/${ctx.repo}`;
  refreshLinks();

  const [registered, open, defs, register, deadlines] = await Promise.all([
    gh(t, "GET", `/repos/${ctx.org}/${ctx.repo}/issues?labels=registered&state=all&per_page=100`),
    gh(t, "GET", `/repos/${ctx.org}/${ctx.repo}/issues?labels=registration&state=open&per_page=100`),
    loadAssignments(),
    lastRun(t, "register.yml"),
    lastRun(t, "deadlines.yml"),
  ]);
  const waiting = open.filter((i) => !i.labels.some((l) => l.name === "registered"));

  const stats = $("stats");
  stats.innerHTML = "";
  const stat = (n, label, href) => {
    const d = el("a", undefined, "stat");
    d.href = href;
    d.append(el("strong", String(n) + (n === 100 ? "+" : "")), el("span", label));
    stats.append(d);
  };
  stat(registered.length, registered.length === 1 ? "group registered" : "groups registered",
    `${base}/issues?q=label%3Aregistered`);
  stat(waiting.length, "waiting for members to confirm", `${base}/issues?q=is%3Aopen+label%3Aregistration`);
  stat(defs.length, defs.length === 1 ? "assignment" : "assignments", `${base}/tree/${session.branch}/assignments`);

  const health = $("health");
  health.innerHTML = "";
  for (const [what, run] of [["Registrations", register], ["Deadlines", deadlines]]) {
    const li = el("li");
    if (!run) { li.className = "warn"; li.append(`${what}: hasn't run yet.`); }
    else if (run.status !== "completed") { li.className = "run"; li.append(`${what}: running now. `, linkTo(run.html_url, "Its log")); }
    else if (run.conclusion === "success") { li.className = "ok"; li.append(`${what}: last ran ${ago(run.updated_at)}, fine. `); }
    else {
      li.className = "bad";
      li.append(`${what}: the last run ${ago(run.updated_at)} ${run.conclusion}. If the bot's token ran out, replace it below. `,
        linkTo(run.html_url, "Its log"));
    }
    health.append(li);
  }

  const body = $("assignmentTable").tBodies[0];
  body.innerHTML = "";
  $("noAssignments").hidden = defs.length > 0;
  $("assignmentTable").hidden = !defs.length;
  const now = Date.now();
  for (const d of defs) {
    const tr = el("tr");
    const name = el("td");
    name.append(linkTo(`https://github.com/${ctx.org}/${d.template || `${d.name}-template`}`, d.name));
    const soft = el("td");
    const byClass = Object.entries(d.soft_by_class || {});
    if (byClass.length) for (const [c, iso] of byClass.sort()) soft.append(el("div", `${c}: ${when(iso)}`));
    else soft.textContent = d.soft_deadline ? when(d.soft_deadline) : "—";
    const hard = el("td", d.hard_deadline ? when(d.hard_deadline) : "Never locks");
    const softs = byClass.length ? byClass.map(([, iso]) => Date.parse(iso)) : d.soft_deadline ? [Date.parse(d.soft_deadline)] : [];
    const state = d.hard_deadline && Date.parse(d.hard_deadline) <= now ? "Locked"
      : softs.length && softs.every((x) => x <= now) ? "Late from here"
      : softs.some((x) => x <= now) ? "Late for some classes" : "Open";
    tr.append(name, soft, hard, el("td", state));
    body.append(tr);
  }
}

async function lastRun(token, workflow) {
  try {
    const r = await gh(token, "GET", `/repos/${ctx.org}/${ctx.repo}/actions/workflows/${workflow}/runs?per_page=1`);
    return r.workflow_runs?.[0] || null;
  } catch (e) { if (e.status === 404) return null; throw e; }
}

async function refresh() {
  try { await loadOverview(); setStatus("overviewStatus", ""); }
  catch (e) {
    setStatus("overviewStatus", e instanceof GitHubError && e.status === 403 && !ctx.token
      ? "GitHub limits how often a page can read it without a token. Try again in a while, or check a token below."
      : e.message, "bad");
  }
}

// ---------- changing: with a checked token ----------
function refreshLinks() {
  const days = (id, d) => Math.min(366, Math.max(1, parseInt($(id).value, 10) || d));
  $("courseTokenLink").href = tokenUrl(ctx.org, `bedel course (${ctx.org})`,
    "Changes the course from its page", days("courseDays", 7), COURSE_PERMISSIONS);
  $("botTokenLink").href = tokenUrl(ctx.org, `bedel bot (${ctx.org})`,
    "The course bot's token: creates teams and repos, locks them at deadlines", days("botDays", 180), BOT_PERMISSIONS);
}

async function signIn() {
  const list = $("courseChecks");
  list.innerHTML = "";
  const passed = (t) => list.append(el("li", t));
  setStatus("courseTokenStatus", "Checking…");
  const token = $("courseToken").value.trim();
  try {
    ctx.login = await checkToken(token, ctx.org, passed);
    ctx.token = token;
  } catch (e) {
    ctx.login = null; ctx.token = "";
    $("tools").hidden = true;
    return setStatus("courseTokenStatus", e.message, "bad");
  }
  setStatus("courseTokenStatus", `Ready. Changes are made as ${ctx.login}.`, "ok");
  if (course) fillCourse(course);
  $("tools").hidden = false;
  await refresh();
}

function showTab(name) {
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
}

async function saveCourse() {
  const log = logger("courseLog");
  const { course: next, errors } = readCourse();
  if (errors.length) throw new Error(errors.join(" "));
  const sha = await ops.writeCourse(log, ctx.token, ctx.org, ctx.repo, next);
  if (sha) await ops.generateStudentFiles(log, ctx.token, ctx.org, ctx.repo, sha);
  await refresh();
}

async function saveStudents() {
  const log = logger("studentsLog");
  if (!students.roster && !students.classes) throw new Error("Choose the roster file (or class listings) first.");
  const n = Math.max(0, Math.min(20, parseInt($("testN").value, 10) || 0));
  await ops.storeStudents(log, ctx.token, ctx.org, ctx.repo, n);
}

async function saveBot() {
  const log = logger("botLog");
  const token = $("botToken").value.trim();
  if (token === ctx.token) throw new Error("That's the token this page is using. The bot needs its own, made with the link above.");
  const s = log("Checking the new token");
  const login = await checkToken(token, ctx.org, (t) => log(t, "ok"));
  s(`It acts as ${login}`);
  await ops.storeBotToken(log, ctx.token, ctx.org, ctx.repo, token);
  $("botToken").value = "";
}

// ---------- wiring ----------
initPage();
initCourseForm();
initStudentInputs();
initAssignmentForm();

$("pickGo").onclick = () => {
  const r = $("pickRepo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  if (REPO_RE.test(r)) location.search = `?repo=${r}`;
};
$("pickRepo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pickGo").click(); });
$("copyLink").onclick = async () => {
  try { await navigator.clipboard.writeText($("studentLink").value); $("copyLink").textContent = "Copied"; }
  catch { $("studentLink").select(); }
};
$("checkCourse").onclick = signIn;
$("courseToken").addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); });
$("courseDays").addEventListener("input", refreshLinks);
$("botDays").addEventListener("input", refreshLinks);
for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => showTab(b.dataset.tab);
runButton("runRelease", "releaseLog", async () => { await release(); await refresh(); });
runButton("saveCourse", "courseLog", saveCourse);
runButton("saveStudents", "studentsLog", saveStudents);
runButton("saveBot", "botLog", saveBot);

const repo = await whichRepo();
if (!repo) $("pick").hidden = false;
else {
  [ctx.org, ctx.repo] = repo.split("/");
  $("course").hidden = false;
  await refresh();
}
