// Checking the setup token, and the setup run itself (steps 1-6 of setup.sh).
import { $, logger } from "./dom.js";
import { TEMPLATE, gh, exists, paginate, sleep, b64FromText, textFromB64, setSecret, probe,
         waitForRun } from "./github.js";
import { readCourse, fillCourse } from "./course.js";
import { session, students, target } from "./state.js";
import { loadAssignments } from "./assignments.js";

// What scripts/setup/01_org_settings.sh sets.
const ORG_SETTINGS = {
  default_repository_permission: "none",        // members see only what their team is given
  members_can_create_repositories: false,       // only the bot creates repos
  members_can_create_public_repositories: false,
  members_can_create_private_repositories: false,
  members_can_create_pages: false,
  members_can_delete_repositories: false,       // students can't delete their work
  members_can_change_repo_visibility: false,    // no accidentally public solutions
  members_can_create_teams: false,              // only the bot creates teams
};
// What scripts/setup/03_labels.sh creates.
const LABELS = [
  { name: "registration", color: "1D76DB", description: "Group registration request" },
  { name: "registered", color: "0E8A16", description: "Team and repos created" },
  { name: "class-mismatch", color: "D93F0B", description: "A member's class differs from the faculty listing - check it" },
];

export async function checkSetup() {
  const { org, repo, token } = target();
  if (!org) throw new Error("Enter the organization first.");
  if (!token) throw new Error("Paste the setup token first.");
  const me = await gh(token, "GET", "/user").catch((e) => {
    throw new Error(e.status === 401 ? "GitHub doesn't accept that token. Copy it again, or make a new one." : e.message);
  });
  session.login = me.login;
  let role = null;
  try { role = (await gh(token, "GET", `/user/memberships/orgs/${org}`)).role; }
  catch (e) {
    if (e.status === 404) throw new Error(`${me.login} isn't a member of ${org}, or the organization doesn't exist.`);
    if (e.status === 403) throw new Error(`GitHub refused the token for ${org}: ${e.message}. If the organization approves tokens, approve it under Organization settings → Personal access tokens.`);
    throw e;
  }
  if (role !== "admin") throw new Error(`${me.login} is a member of ${org} but not an owner. Setup needs an owner.`);

  session.repoExists = await exists(token, `/repos/${org}/${repo}`);
  let loaded = false;
  if (session.repoExists) {
    const info = await gh(token, "GET", `/repos/${org}/${repo}`);
    session.branch = info.default_branch || "main";
    try {
      const f = await gh(token, "GET", `/repos/${org}/${repo}/contents/course.json`);
      fillCourse(JSON.parse(textFromB64(f.content)));
      loaded = true;
    } catch (e) { if (e.status !== 404) throw e; }
    await loadAssignments();
  }
  return `Signed in as ${me.login}, an owner of ${org}. ` +
    (session.repoExists ? `${org}/${repo} exists${loaded ? "; its course settings are loaded below" : ""}.`
                        : `${org}/${repo} will be created.`);
}

export async function runSetup() {
  const log = logger("setupLog");
  $("setupDone").className = "done";
  const { org, repo, token } = target();
  const first = log("Checking the setup token");
  first(await checkSetup());

  const { course, errors } = readCourse();
  if (errors.length) throw new Error(errors.join(" "));

  await lockDownOrg(log, token, org);
  await createRepo(log, token, org, repo, course);
  await addLabels(log, token, org, repo);
  await storeBotToken(log, token, org, repo, $("botToken").value.trim());
  const tests = await storeStudents(log, token, org, repo);
  // course.json last: the workflows stay idle until it's there, so they never
  // start before the secrets they need.
  const headSha = await writeCourse(log, token, org, repo, course);
  await generateStudentFiles(log, token, org, repo, headSha);
  showDone(org, repo, tests);
  await loadAssignments();
}

async function lockDownOrg(log, token, org) {
  const s = log("Locking down what members can do in the organization");
  const current = await gh(token, "GET", `/orgs/${org}`);
  const change = Object.fromEntries(Object.entries(ORG_SETTINGS).filter(([k, v]) => current[k] !== v));
  if (!Object.keys(change).length) return s("Organization permissions already locked down");
  const failed = [];
  try { await gh(token, "PATCH", `/orgs/${org}`, change); }
  catch {
    for (const [k, v] of Object.entries(change)) {
      try { await gh(token, "PATCH", `/orgs/${org}`, { [k]: v }); } catch { failed.push(k); }
    }
  }
  if (failed.length) s(`Organization permissions set, except ${failed.join(", ")} (not available on this plan)`, "warn");
  else s("Organization permissions locked down: base permission none, members can't create or delete repos or teams");
}

async function createRepo(log, token, org, repo, course) {
  const s = log(`Creating ${org}/${repo} from ${TEMPLATE}`);
  if (session.repoExists) s(`${org}/${repo} already exists`);
  else {
    await gh(token, "POST", `/repos/${TEMPLATE}/generate`, {
      owner: org, name: repo, private: false, include_all_branches: false,
      description: `Group registration, repos and deadlines for ${course.name} (bedel)`,
    });
    // GitHub fills a generated repository in a moment after creating it.
    for (let i = 0; i < 45; i++) {
      try { if ((await gh(token, "GET", `/repos/${org}/${repo}/commits?per_page=1`)).length) break; }
      catch (e) { if (![404, 409].includes(e.status)) throw e; }
      await sleep(2000);
    }
    session.repoExists = true;
    s(`Created ${org}/${repo}, public so students outside the organization can open the form`);
  }
  const info = await gh(token, "GET", `/repos/${org}/${repo}`);
  session.branch = info.default_branch || "main";
  if (info.private) {
    log(`${org}/${repo} is private: students who aren't members yet can't see the form. Make it public in its settings.`, "warn");
  }
}

async function addLabels(log, token, org, repo) {
  const s = log("Adding the labels the bot uses");
  const have = new Set((await paginate(token, `/repos/${org}/${repo}/labels`)).map((l) => l.name));
  const added = [];
  for (const l of LABELS) {
    if (!have.has(l.name)) { await gh(token, "POST", `/repos/${org}/${repo}/labels`, l); added.push(l.name); }
  }
  s(added.length ? `Labels added: ${added.join(", ")}` : "Labels already there");
}

// The same checks as scripts/setup/04_admin_token.sh, before the token is stored.
async function storeBotToken(log, token, org, repo, botToken) {
  const s = log("Checking the bot's token");
  if (!botToken) {
    if (!(await exists(token, `/repos/${org}/${repo}/actions/secrets/ORG_ADMIN_TOKEN`))) {
      throw new Error("There's no bot token stored yet. Create one in step 5 and paste it.");
    }
    return s("Keeping the bot token already stored");
  }
  let bot;
  try { bot = await gh(botToken, "GET", "/user"); }
  catch { throw new Error("GitHub doesn't accept the bot's token. Copy it again, or make a new one."); }
  const checks = [
    ["create teams (Members)", `/orgs/${org}/teams`],
    ["create repositories (Administration)", `/orgs/${org}/repos`],
    ["write files (Contents)", `/repos/${org}/${repo}/git/blobs`],
    ["mark commits (Commit statuses)", `/repos/${org}/${repo}/statuses/0000000000000000000000000000000000000000`],
    ["open issues (Issues)", `/repos/${org}/${repo}/issues`],
  ];
  const bad = [];
  for (const [what, path] of checks) {
    const r = await probe(botToken, path);
    if (r === "denied") bad.push(what);
    else if (r !== "ok") log(`Couldn't tell whether the bot's token can ${what}: ${r}`, "warn");
  }
  if (bad.length) throw new Error(`The bot's token can't ${bad.join(", ")}. Make a new one with the link in step 5.`);
  // "All repositories" can't be read off a token; what can be seen is whether
  // it reaches every repository the owner can see right now.
  const mine = new Set((await paginate(token, `/orgs/${org}/repos?type=all`)).map((r) => r.name));
  const its = new Set((await paginate(botToken, `/orgs/${org}/repos?type=all`)).map((r) => r.name));
  const missing = [...mine].filter((n) => !its.has(n));
  if (missing.length) {
    throw new Error(`The bot's token reaches only ${mine.size - missing.length} of ${mine.size} repositories. Make a new one with Repository access: All repositories.`);
  }
  await setSecret(token, org, repo, "ORG_ADMIN_TOKEN", botToken);
  s(`Bot token (${bot.login}) checked and stored as the secret ORG_ADMIN_TOKEN`);
}

async function storeStudents(log, token, org, repo) {
  const testN = Math.max(0, Math.min(20, parseInt($("testN").value, 10) || 0));
  const tests = Array.from({ length: testN }, (_, i) => `999${String(i + 1).padStart(2, "0")}`);
  const s = log("Storing the roster");
  if (students.roster) {
    await setSecret(token, org, repo, "ROSTER", [...students.roster, ...tests].join("\n"));
    s(`Roster stored as the secret ROSTER: ${students.roster.length} students` + (testN ? ` and ${testN} test students` : ""));
  } else if (await exists(token, `/repos/${org}/${repo}/actions/secrets/ROSTER`)) {
    s("Keeping the roster already stored" + (testN ? " (choose the roster file again to add test students)" : ""),
      testN ? "warn" : "ok");
  } else {
    throw new Error("No roster yet: choose the roster file in step 4, so the bot knows who may register.");
  }
  if (students.classes) {
    const c = log("Storing the class listings");
    await setSecret(token, org, repo, "CLASSES", students.classes.map(([n, k]) => `${n},${k}`).join("\n"));
    c(`Classes stored as the secret CLASSES: ${students.classes.length} students`);
  }
  return tests;
}

// Returns the commit that changed course.json, or null if it was already current.
async function writeCourse(log, token, org, repo, course) {
  const s = log("Writing course.json");
  const text = JSON.stringify(course, null, 2) + "\n";
  let sha = null;
  try {
    const f = await gh(token, "GET", `/repos/${org}/${repo}/contents/course.json`);
    sha = f.sha;
    if (textFromB64(f.content) === text) { s("course.json already up to date"); return null; }
  } catch (e) { if (e.status !== 404) throw e; }
  const res = await gh(token, "PUT", `/repos/${org}/${repo}/contents/course.json`, {
    message: sha ? `Update the course: ${course.name}` : `Set up the course: ${course.name}`,
    content: b64FromText(text), ...(sha ? { sha } : {}), branch: session.branch,
  });
  s(sha ? "course.json updated" : "course.json written");
  return res.commit.sha;
}

// The students' README and form are generated by the Course files workflow
// (.github/workflows/course.yml), so the Python stays the one place they're made.
async function generateStudentFiles(log, token, org, repo, headSha) {
  const s = log("Generating the students' page and form (a GitHub Actions run, about a minute)");
  if (!headSha && await exists(token, `/repos/${org}/${repo}/contents/.github/ISSUE_TEMPLATE/register.yml`)) {
    return s("Students' page and form already generated");
  }
  const since = Date.now() - 60000;
  if (!headSha) {
    await gh(token, "POST", `/repos/${org}/${repo}/actions/workflows/course.yml/dispatches`, { ref: session.branch });
  }
  const run = await waitForRun(token, org, repo, "course.yml",
    (r) => headSha ? r.head_sha === headSha : Date.parse(r.created_at) >= since,
    (u) => s(`Generating the students' page and form: ${u}`, "run"));
  if (run.conclusion !== "success") throw new Error(`The Course files workflow ${run.conclusion}: ${run.html_url}`);
  s("Students' page and form generated");
}

function showDone(org, repo, tests) {
  const link = `https://github.com/${org}/${repo}/issues/new?template=register.yml`;
  const done = $("setupDone");
  done.innerHTML = `<strong>Your course is ready.</strong> Give your students this link:<br><a></a><br><br>
    Try it first with two accounts of your own${tests.length ? ` and the test numbers ${tests.slice(0, 2).join(" and ")}`
      : " (set Test students to 2 and run this again)"}.
    The repository is <a></a>; your settings live in its <code>course.json</code>.`;
  const [a1, a2] = done.querySelectorAll("a");
  a1.href = a1.textContent = link;
  a2.href = `https://github.com/${org}/${repo}`;
  a2.textContent = `${org}/${repo}`;
  done.className = "done show";
}
