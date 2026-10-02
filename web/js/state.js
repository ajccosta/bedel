// What the page knows about the course it's working on.
import { $ } from "./dom.js";

export const session = { login: null, branch: "main", repoExists: false, assignments: [] };

// The student lists, once read: numbers only.
export const students = { roster: null, rosterText: null, classes: null };

export function target() {
  return { org: $("org").value.trim(), repo: $("repo").value.trim() || "registration",
           token: $("setupToken").value.trim() };
}
