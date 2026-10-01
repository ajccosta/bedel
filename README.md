# bedel

**Group registration, per-assignment repositories and deadlines for a course on
GitHub, run from one repository in your own organization.** A small, self-hosted
alternative to GitHub Classroom and classroom50, built on nothing but issues,
teams and GitHub Actions.

*Bedel* is Portuguese for the university porter who keeps the rooms and the
timetable: he lets you in, and he locks the door when time is up.

## What it does

- **Groups register themselves.** Students fill in an issue form with their
  student numbers and GitHub usernames. The bot checks each number against your
  roster, waits for every member to reply `/confirm`, then creates their team
  and invites them to the organization.
- **One private repository per group per assignment.** Release an assignment
  with one command: it becomes a template, and every group gets a repo seeded
  from it and an issue that emails them it is out. Groups registering later get
  theirs automatically.
- **Work carries over.** An assignment can start as a copy of each group's
  previous one, with the full history, and the new starting files committed on
  top.
- **Soft and hard deadlines.** Pushing after the soft one is allowed and
  recorded. At the hard one, the repositories become read-only, on the minute.
  Soft deadlines can follow each class's own weekly session, and the rule is a
  short Python function you can rewrite.
- **Evidence students can't rewrite.** Commits after the soft deadline are
  marked late in GitHub itself, and every push is archived to a private repo,
  so a force-push doesn't erase when something happened.
- **Reports.** Who pushed what before which deadline, as a table or CSV.
- **Clean teardown.** One command removes test groups, repos and invitations
  after a dry run.

Only student numbers ever reach GitHub: names, emails and the rest of your
lists stay on your machine.

## Compared with GitHub Classroom

Like GitHub Classroom, every group gets its own repository seeded from a
template. The difference is where it runs: bedel is plain files in a repository
you own, inside your organization. There is no third-party app to authorize,
nothing outside GitHub, and every rule (group size, who may register, how
deadlines are worked out) is code you can read and change.

## Starting a course

You need an organization for the course that you own, `gh` (the GitHub CLI)
logged in, `git`, and Python 3.9 or later.

```sh
git clone https://github.com/ajccosta/bedel registration
cd registration
./scripts/setup.sh YOUR-ORG
```

Setup walks through seven steps and asks before each one: organization
permissions, creating `YOUR-ORG/registration` and pushing this checkout to it,
labels, the admin token (a pre-filled page; GitHub has no API for making one),
the roster, the course itself (name, group size, time zone, classes) and a
final check. It ends with the link to give your students.

The clone keeps bedel as the `upstream` remote, so later fixes are one command
away: `git pull upstream main`. **Use this template** on GitHub works too, but
then the copy has no history in common with bedel, and updates have to be
merged in by hand.

Everything about the course lives in `course.json`; everything else is the same
for every course. The full guide, including assignments, deadlines, testing and
resetting, is in [scripts/README.md](scripts/README.md).
