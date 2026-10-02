// The Assignments page: every assignment with its deadlines, which anyone can
// read, and with a token, a form to change them and each group's repository.
import { logger } from "./dom.js";
import { gh, paginate, waitForRun } from "./github.js";
import { ctx, session } from "./state.js";

const TEAM_RE = /^g\d+_\d+(?:_\d+)*$/;   // ghlib.TEAM_RE: a registered group's team
let teams = null;                         // the groups, read once per sign-in
let kept = null;                          // a save's log, carried into the re-drawn card

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function linkTo(href, text) { const a = el("a", text); a.href = href; return a; }
function field(label, input) { const l = el("label", label + " "); l.append(input); return l; }
function input(type, value = "") { const i = el("input"); i.type = type; i.value = value; return i; }

// An ISO time as the "YYYY-MM-DDTHH:MM" a datetime-local input wants, in the course's time zone.
function local(iso, tz) {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function stateOf(d, now = Date.now()) {
  const byClass = Object.values(d.soft_by_class || {});
  const softs = byClass.length ? byClass.map(Date.parse) : d.soft_deadline ? [Date.parse(d.soft_deadline)] : [];
  if (d.hard_deadline && Date.parse(d.hard_deadline) <= now) return ["Locked", "bad"];
  if (softs.length && softs.every((x) => x <= now)) return ["Late from here", "warn"];
  if (softs.some((x) => x <= now)) return ["Late for some classes", "warn"];
  return ["Open", "ok"];
}

// ---------- the list ----------
export function renderAssignments(defs, course, when) {
  const list = document.getElementById("asgList");
  list.innerHTML = "";
  document.getElementById("asgNone").hidden = defs.length > 0;
  for (const d of [...defs].reverse()) list.append(card(d, course, when));   // newest first
  kept = null;
}

function card(d, course, when) {
  const box = el("article", undefined, "asg");
  box.dataset.name = d.name;
  const head = el("header");
  const [state, kind] = stateOf(d);
  head.append(el("h3", d.name), el("span", state, `pill ${kind}`));
  box.append(head);

  const meta = el("p", undefined, "hint");
  if (d.own_work) meta.append("Groups bring their own work");
  else meta.append("Starting files from ", linkTo(`https://github.com/${ctx.org}/${d.template || `${d.name}-template`}`, d.template || `${d.name}-template`));
  if (d.created) meta.append(` · released ${when(d.created)}`);
  box.append(meta);

  const dl = el("dl", undefined, "deadlines");
  const soft = el("dd");
  const byClass = Object.entries(d.soft_by_class || {}).sort();
  if (byClass.length) for (const [c, iso] of byClass) soft.append(el("div", `${c}: ${when(iso)}`));
  else soft.textContent = d.soft_deadline ? when(d.soft_deadline) : "None";
  dl.append(el("dt", byClass.length ? "Soft, by class" : "Soft"), soft,
            el("dt", "Hard"), el("dd", d.hard_deadline ? `${when(d.hard_deadline)} — repositories lock` : "Never locks"));
  box.append(dl);

  if (!ctx.login) return box;

  const actions = el("div", undefined, "row");
  const edit = el("button", "Edit deadlines", "btn small");
  edit.type = "button";
  actions.append(edit);
  box.append(actions);
  const form = editForm(d, course);
  form.hidden = true;
  box.append(form);
  edit.onclick = () => { form.hidden = !form.hidden; edit.textContent = form.hidden ? "Edit deadlines" : "Close"; };
  if (kept?.name === d.name) {   // just saved: stay open, with the save's log
    form.querySelector("ol.log").replaceWith(kept.log);
    edit.click();
  }

  const groups = el("details", undefined, "groups");
  groups.append(el("summary", "Each group's repository"));
  const table = el("div", "Loading…", "hint");
  groups.append(table);
  groups.addEventListener("toggle", () => { if (groups.open) loadGroups(d, table, when); });
  box.append(groups);
  return box;
}

// ---------- changing the deadlines ----------
function editForm(d, course) {
  const tz = course?.timezone || "UTC";
  const classes = Object.keys(course?.classes || {}).length > 0;
  const id = `edit-${d.name}`;
  const form = el("div", undefined, "edit");

  const mode = el("select");
  mode.add(new Option("By class: a week after each class's session in…", "week"));
  mode.add(new Option("One date for everyone", "date"));
  mode.add(new Option("None", "none"));
  mode.options[0].disabled = !classes;
  mode.value = !d.soft_manual && d.soft_week && classes ? "week" : d.soft_deadline ? "date" : d.soft_manual ? "none" : "date";
  const week = input("date", d.soft_week || "");
  const date = input("datetime-local", local(d.soft_deadline, tz));
  const weekWrap = field("Week of", week);
  const dateWrap = field("On", date);
  const showMode = () => { weekWrap.hidden = mode.value !== "week"; dateWrap.hidden = mode.value !== "date"; };
  mode.onchange = showMode;
  showMode();

  const hard = input("datetime-local", local(d.hard_deadline, tz));
  const never = input("checkbox");
  never.checked = !d.hard_deadline;
  hard.disabled = never.checked;
  never.onchange = () => { hard.disabled = never.checked; };
  const neverLabel = el("label", undefined, "check");
  neverLabel.append(never, " Never lock");

  const r1 = el("div", undefined, "row"); r1.append(field("Soft deadline", mode), weekWrap, dateWrap);
  const r2 = el("div", undefined, "row"); r2.append(field("Hard deadline (repositories lock)", hard), neverLabel);
  const note = el("p", `Times are in ${tz}. Saving changes only the dates: repositories and their work stay as they are. `
    + "A repository already locked opens again if the hard deadline moves later.", "hint");
  const save = el("button", "Save the deadlines", "btn primary");
  save.type = "button";
  const log = el("ol", undefined, "log");
  log.id = `${id}-log`;
  form.append(r1, r2, note, save, log);

  save.onclick = async () => {
    save.disabled = true;
    try {
      const inputs = { name: d.name, dry_run: "false" };
      if (mode.value === "week") {
        if (!week.value) throw new Error("Pick the week the class sessions start the clock.");
        inputs.soft_week = week.value;
      } else if (mode.value === "date") {
        if (!date.value) throw new Error("Pick the soft deadline.");
        inputs.soft = date.value.replace("T", " ");
      } else inputs.soft = "none";
      if (never.checked) inputs.hard = "none";
      else if (!hard.value) throw new Error("Pick the hard deadline, or tick Never lock.");
      else inputs.hard = hard.value.replace("T", " ");
      await saveDeadlines(logger(log.id), inputs);
      // The page reads the new dates back; the log stays, in a card re-drawn around it.
      document.dispatchEvent(new CustomEvent("assignments-changed", { detail: { name: d.name, log } }));
    } catch (e) {
      const li = el("li", e.message, "bad");
      log.append(li);
    } finally {
      for (const li of log.querySelectorAll("li.run")) li.className = "warn";
      save.disabled = false;
    }
  };
  return form;
}

// The same workflow that released it, given only the dates: new_assignment.py
// keeps the repositories and rewrites assignments/<name>.json. Then the
// deadlines run, so locks follow the new dates now rather than within 30 minutes.
async function saveDeadlines(log, inputs) {
  const { org, repo, token } = ctx;
  const s = log(`Saving ${inputs.name}'s deadlines`);
  const since = Date.now() - 10000;
  await gh(token, "POST", `/repos/${org}/${repo}/actions/workflows/assignment.yml/dispatches`,
    { ref: session.branch, inputs });
  const run = await waitForRun(token, org, repo, "assignment.yml",
    (r) => r.event === "workflow_dispatch" && Date.parse(r.created_at) >= since,
    (u) => s(`Saving the deadlines: ${u}`, "run"), 10);
  if (run.conclusion !== "success") throw new Error(`Saving ${run.conclusion}. What went wrong is in its log: ${run.html_url}`);
  s(`${inputs.name}'s deadlines saved`, "ok", [{ label: "Log ↗", href: run.html_url }]);

  const l = log("Locking or opening repositories to match");
  const after = Date.now() - 10000;
  await gh(token, "POST", `/repos/${org}/${repo}/actions/workflows/deadlines.yml/dispatches`,
    { ref: session.branch, inputs: { report_only: "false" } });
  // It can sit waiting for a deadline due in the next half hour, so this only
  // waits for it to start, and leaves the link.
  for (let i = 0; i < 30; i++) {
    const runs = await gh(token, "GET", `/repos/${org}/${repo}/actions/workflows/deadlines.yml/runs?per_page=5`);
    const r = (runs.workflow_runs || []).find((x) => x.event === "workflow_dispatch" && Date.parse(x.created_at) >= after);
    if (r) return l("Locking or opening repositories to match: started", "ok", [{ label: "Its log ↗", href: r.html_url }]);
    await new Promise((res) => setTimeout(res, 3000));
  }
  l("The deadlines run didn't start; the next scheduled one, within 30 minutes, applies the new dates", "warn");
}

// ---------- each group's repository ----------
async function loadGroups(d, box, when) {
  const { org, token } = ctx;
  try {
    teams ||= (await paginate(token, `/orgs/${org}/teams`)).filter((t) => TEAM_RE.test(t.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!teams.length) { box.textContent = "No groups registered yet."; return; }
    const rows = await Promise.all(teams.map(async (t) => {
      const name = `${t.name}-${d.name}`;
      try {
        const [info, access] = await Promise.all([
          gh(token, "GET", `/repos/${org}/${name}`),
          gh(token, "GET", `/repos/${org}/${name}/teams`),
        ]);
        const perm = access.find((x) => x.slug === t.slug)?.permission;
        // An empty repository reports its creation as its last push.
        const pushed = info.pushed_at && Date.parse(info.pushed_at) - Date.parse(info.created_at) > 60000 ? info.pushed_at : null;
        return { t, name, pushed, state: { push: "Writable", pull: "Read-only" }[perm] || (perm ? perm : "No access") };
      } catch (e) {
        if (e.status === 404) return { t, name, missing: true };
        throw e;
      }
    }));
    const table = el("table", undefined, "compare plain");
    const head = el("tr");
    for (const h of ["Group", "Repository", "Last push", "Access"]) head.append(el("th", h));
    const thead = el("thead"); thead.append(head);
    const body = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      tr.append(el("td", r.t.name));
      if (r.missing) {
        tr.append(el("td", "Not created yet"), el("td", "—"), el("td", "—"));
      } else {
        const repoCell = el("td"); repoCell.append(linkTo(`https://github.com/${org}/${r.name}`, r.name));
        tr.append(repoCell, el("td", r.pushed ? when(r.pushed) : "Nothing pushed yet"), el("td", r.state));
      }
      body.append(tr);
    }
    table.append(thead, body);
    const wrap = el("div", undefined, "table-scroll");
    wrap.append(table);
    box.className = "";
    box.textContent = "";
    box.append(wrap);
  } catch (e) {
    box.className = "status bad";
    box.textContent = e.message;
  }
}

export function forgetGroups() { teams = null; }
export function keepLog(name, log) { kept = { name, log }; }
