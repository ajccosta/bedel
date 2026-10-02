// A student's own view of their group: with a read-only key of theirs, how each
// of the group's repositories is doing. GitHub gives the key the student's own
// access, so it can't see any other group's repositories, whatever the page asks.
import { gh, paginate, GitHubError } from "./github.js";
import { tokenUrl } from "./tokens.js";
import { ctx } from "./state.js";
import { stateOf } from "./asgpage.js";

// Contents: read is all it asks for; GitHub adds Metadata: read, which every token has.
export const STUDENT_PERMISSIONS = { contents: "read" };
const GROUP_REPO = /^(g\d+_\d+(?:_\d+)*)-(.+)$/;   // gXX_<numbers>-<assignment>

export const studentTokenUrl = (org) =>
  tokenUrl(org, `bedel ${org} (read only)`, "Reads my group's repositories for the course page", 30, STUDENT_PERMISSIONS);

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function linkTo(href, text) { const a = el("a", text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }

// Throws, in words a student can act on, unless the key works and shows at least
// one of their group's repositories. Returns what the page shows.
export async function loadMine(token, defs) {
  const { org, repo } = ctx;
  if (!token) throw new Error("Paste the key first.");
  if (!token.startsWith("github_pat_")) {
    throw new Error(token.startsWith("ghp_")
      ? "That's a classic token, which can read and change everything you can on GitHub. Make a fine-grained one with the link above: it reads only this course."
      : "That doesn't look like a key from the link above: those start with github_pat_.");
  }
  let me;
  try { me = await gh(token, "GET", "/user"); }
  catch (e) {
    if (e.status === 401) throw new Error("GitHub doesn't accept that key. Copy it again, or make a new one: it may have expired.");
    throw e;
  }
  let repos;
  try { repos = await paginate(token, `/orgs/${org}/repos?type=all`); }
  catch (e) {
    if (e instanceof GitHubError && e.status === 404) throw new Error(`This key can't see ${org}. Its Resource owner must be ${org}.`);
    throw e;
  }
  const mine = repos.map((r) => ({ r, m: r.name.match(GROUP_REPO) })).filter((x) => x.m && x.r.private);
  if (!mine.length) {
    throw new Error(`This key, ${me.login}'s, sees none of your group's repositories. Either: its Resource owner isn't ${org}; `
      + `it's waiting for your teacher's approval (GitHub says so on your token's page); you haven't accepted the invitation to ${org}; `
      + "or your group isn't registered yet.");
  }
  const group = mine[0].m[1];
  const classes = await groupClasses(token, org, repo, group);
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
  const rows = await Promise.all(mine.map(async ({ r, m }) => {
    const d = byName[m[2]] || { name: m[2] };
    let commits = [];
    try { commits = await paginate(token, `/repos/${org}/${r.name}/commits`); }
    catch (e) { if (e.status !== 409) throw e; }   // 409: still empty
    return { r, d, commits, soft: softFor(d, classes) };
  }));
  // In the order the assignments were released.
  const order = defs.map((d) => d.name);
  rows.sort((a, b) => order.indexOf(a.d.name) - order.indexOf(b.d.name));
  return { login: me.login, group, classes, rows };
}

// The group's classes, from the bot's reply on its registration issue, which is public.
async function groupClasses(token, org, repo, group) {
  try {
    const issues = await paginate(token, `/repos/${org}/${repo}/issues?labels=registered&state=all`);
    const issue = issues.find((i) => i.title.endsWith(group));
    if (!issue) return [];
    const comments = await paginate(token, `/repos/${org}/${repo}/issues/${issue.number}/comments`);
    const reply = comments.reverse().find((c) => c.body.includes("registered as"));
    return [...new Set([...(reply?.body || "").matchAll(/→ \*\*([A-Za-z0-9]+)\*\*/g)].map((x) => x[1]))];
  } catch { return []; }
}

// The default rule (rules.py): a week from the earliest member's session, so the
// earliest of the group's classes. A date set by hand applies to everyone.
function softFor(d, classes) {
  const byClass = d.soft_by_class || {};
  if (!d.soft_manual && classes.length && classes.some((c) => byClass[c])) {
    return classes.map((c) => byClass[c]).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  }
  return d.soft_deadline || null;
}

export function renderMine(box, data, when) {
  box.innerHTML = "";
  const intro = el("p", undefined, "sub");
  intro.append(`Group ${data.group}`, data.classes.length ? `, class ${data.classes.join(" and ")}` : "", `. Seen with ${data.login}'s key.`);
  box.append(intro);
  for (const { r, d, commits, soft } of data.rows) {
    const card = el("article", undefined, "asg");
    const head = el("header");
    const [state, kind] = stateOf(d);
    head.append(el("h3", d.name), el("span", r.permissions?.push === false ? "Read-only" : state,
      `pill ${r.permissions?.push === false ? "bad" : kind}`));
    card.append(head);
    const meta = el("p", undefined, "hint");
    meta.append(linkTo(r.html_url, r.name));
    card.append(meta);

    const late = soft ? commits.filter((c) => Date.parse(c.commit.committer?.date || c.commit.author?.date) > Date.parse(soft)).length : 0;
    const pushed = r.pushed_at && Date.parse(r.pushed_at) - Date.parse(r.created_at) > 60000 ? r.pushed_at : null;
    const stats = el("div", undefined, "stats");
    const stat = (n, label) => { const s = el("div", undefined, "stat"); s.append(el("strong", String(n)), el("span", label)); stats.append(s); };
    stat(commits.length, commits.length === 1 ? "commit" : "commits");
    stat(pushed ? when(pushed) : "—", pushed ? "last push" : "nothing pushed yet");
    if (soft) stat(late, late === 1 ? "commit after the soft deadline" : "commits after the soft deadline");
    card.append(stats);

    const dl = el("dl", undefined, "deadlines");
    dl.append(el("dt", "Your soft deadline"), el("dd", soft ? when(soft) : "None"),
              el("dt", "Hard deadline"), el("dd", d.hard_deadline ? `${when(d.hard_deadline)} — the repository locks` : "Never locks"));
    card.append(dl);

    if (commits.length) {
      const counts = {};
      for (const c of commits) {
        const who = c.author?.login || c.commit.author?.name || "unknown";
        counts[who] = (counts[who] || 0) + 1;
      }
      const max = Math.max(...Object.values(counts));
      const list = el("ul", undefined, "bars");
      for (const [who, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const li = el("li");
        const bar = el("span", undefined, "bar");
        bar.style.setProperty("--w", `${Math.round((n / max) * 100)}%`);
        li.append(el("span", who, "name"), bar, el("span", String(n), "n"));
        list.append(li);
      }
      card.append(el("h4", "Commits by member"), list);
    }
    card.append(el("p", "Commit times come from your own computer. Whether work is late is decided by when it was pushed, which is what your teacher sees.", "hint"));
    box.append(card);
  }
}
