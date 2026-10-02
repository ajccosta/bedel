// Links that open GitHub's new-token page already filled in. Repository access
// is the one field GitHub won't take from a link, which is why the page asks
// for "All repositories" in words.

// For this page: setting the course up, then releasing assignments.
export const SETUP_PERMISSIONS = {
  organization_administration: "write",  // lock down what members can do
  administration: "write",               // create the course repository
  contents: "write",                     // course.json, starting files
  issues: "write",                       // labels
  secrets: "write",                      // roster, classes, the bot's token
  actions: "write",                      // run the release workflow
  workflows: "write",                    // the template's workflows, starting files with workflows
  members: "read",                       // check you own the organization
};

// For the bot, kept as a secret all term: what scripts/setup/04_admin_token.sh asks for.
export const BOT_PERMISSIONS = {
  administration: "write", contents: "write", issues: "write",
  statuses: "write", workflows: "write", members: "write",
};

export function tokenUrl(org, name, description, days, permissions) {
  const q = [`name=${encodeURIComponent(name.slice(0, 40))}`,
             `description=${encodeURIComponent(description)}`, `expires_in=${days}`];
  if (org) q.push(`target_name=${encodeURIComponent(org)}`);
  for (const [k, v] of Object.entries(permissions)) q.push(`${k}=${v}`);
  return `https://github.com/settings/personal-access-tokens/new?${q.join("&")}`;
}
