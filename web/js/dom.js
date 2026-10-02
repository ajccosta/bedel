// Small helpers for the page itself.

export const $ = (id) => document.getElementById(id);

export function setStatus(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = "status " + kind;
}

// A list of steps that fill in as they run: log("doing x") adds a line and
// returns a function that rewrites it when the step finishes.
export function logger(listId) {
  const list = $(listId);
  list.innerHTML = "";
  return (text, kind = "run") => {
    const li = document.createElement("li");
    li.className = kind;
    li.textContent = text;
    list.append(li);
    return (t, k = "ok") => { li.textContent = t; li.className = k; };
  };
}

// Runs a button's action, shows any error at the end of its log, and leaves no
// step looking as if it were still running.
export function runButton(buttonId, listId, action) {
  $(buttonId).onclick = async () => {
    const btn = $(buttonId);
    btn.disabled = true;
    try {
      await action();
    } catch (e) {
      const li = document.createElement("li");
      li.className = "bad";
      li.textContent = e.message;
      $(listId).append(li);
    } finally {
      for (const li of $(listId).querySelectorAll("li.run")) li.className = "warn";
      btn.disabled = false;
    }
  };
}
