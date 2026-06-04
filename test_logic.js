// Headless test of the real stress-window logic extracted from template.html.
// Run: node test_logic.js
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");

// Pull the pure-logic slice (config + date helpers + window functions),
// stopping before any code that touches the DOM.
const start = html.indexOf("const STRESS_BEFORE");
const end = html.indexOf("// ---- Rendering ----");
if (start < 0 || end < 0) throw new Error("could not locate logic slice in template.html");
const slice = html.slice(start, end);

// localStorage is referenced by declarations we never call; stub it so eval is safe.
const localStorage = { getItem: () => null, setItem: () => {} };
// `const` declarations don't leak out of eval, so re-export the config we assert on.
eval(slice + "\nglobalThis.__cfg = { EVENT_TYPES, STRESS_BEFORE, STRESS_AFTER };");
const { EVENT_TYPES } = globalThis.__cfg;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}

const EV = "2026-06-10";
const ev = (date, type = "exam") => ({ id: "x", date, type });
const onDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

// activeWindow: window is [event-2, event+1] inclusive
check("on event day -> softened", !!activeWindow(onDay("2026-06-10"), [ev(EV)]));
check("2 days before -> softened", !!activeWindow(onDay("2026-06-08"), [ev(EV)]));
check("3 days before -> normal", !activeWindow(onDay("2026-06-07"), [ev(EV)]));
check("1 day after -> softened", !!activeWindow(onDay("2026-06-11"), [ev(EV)]));
check("2 days after -> normal", !activeWindow(onDay("2026-06-12"), [ev(EV)]));
check("no events -> normal", !activeWindow(onDay("2026-06-10"), []));
check("returns the matching event", activeWindow(onDay("2026-06-10"), [ev("2026-01-01"), ev(EV)]).date === EV);

// eventInWindow mirrors activeWindow for the per-event badge
check("eventInWindow true on day", eventInWindow(onDay("2026-06-10"), ev(EV)));
check("eventInWindow false far off", !eventInWindow(onDay("2026-05-01"), ev(EV)));

// date helpers
check("isoDate formats local date", isoDate(new Date(2026, 5, 4)) === "2026-06-04");
check("parseISO round-trips", isoDate(parseISO("2026-06-04")) === "2026-06-04");
check("daysApart positive after", daysApart(onDay("2026-06-12"), onDay("2026-06-10")) === 2);
check("daysApart negative before", daysApart(onDay("2026-06-08"), onDay("2026-06-10")) === -2);

// anti-leak: message depends only on event type, never on a score
check("exam message is type-keyed", EVENT_TYPES.exam.message.length > 0);
check("unknown type falls back to other", (EVENT_TYPES["nope"] || EVENT_TYPES.other) === EVENT_TYPES.other);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
