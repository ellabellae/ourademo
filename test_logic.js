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
// `OURA_DATA` lives outside the slice, so declare a mutable one autoSoftenToday()
// can close over, plus a setter to drive the auto-detection tests.
eval(
  "var OURA_DATA = [];\n" + slice +
  "\nglobalThis.__cfg = { EVENT_TYPES, STRESS_BEFORE, STRESS_AFTER, AUTO_FLOOR, AUTO_DROP," +
  " CAL_MAX, CAL_STEP, autoSoftenToday, setData: (d) => { OURA_DATA = d; } };"
);
// `autoSoftenToday` and `calibrationOffset` (function decls) leak from the non-strict
// eval into this scope already, so re-binding them via const would collide — use them
// directly. Only pull the values that don't leak (consts + the object's arrow setter).
const { EVENT_TYPES, AUTO_FLOOR, AUTO_DROP, CAL_MAX, CAL_STEP, setData } = globalThis.__cfg;

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

// auto-detection: softens on a "lower-recovery morning"
const steady = (n, today) => Array.from({ length: 13 }, () => ({ readiness: n, sleep: n }))
  .concat([{ readiness: today, sleep: today }]);
setData([]);
check("auto: no data -> normal", autoSoftenToday() === false);
setData(steady(85, 85));
check("auto: high & steady -> normal", autoSoftenToday() === false);
setData(steady(85, AUTO_FLOOR));
check("auto: at the floor -> softened", autoSoftenToday() === true);
setData(steady(90, 90 - AUTO_DROP));
check("auto: meaningful drop vs baseline -> softened", autoSoftenToday() === true);
setData(steady(85, null));
check("auto: missing today readiness -> normal", autoSoftenToday() === false);
setData(steady(85, 84));
check("auto: small dip, still decent -> normal", autoSoftenToday() === false);

// personal calibration from "This doesn't quite match me" logs
const calToday = onDay("2026-06-30");
const mkLogs = (n, dir) => Array.from({ length: n }, (_, i) => {
  const d = new Date(calToday); d.setDate(d.getDate() - i);
  return { date: isoDate(d), readiness: 66, direction: dir };
});

check("cal: no logs -> not triggered", calibrationOffset(calToday, []).triggered === false);

const c5b = calibrationOffset(calToday, mkLogs(5, "better"));
check("cal: 5 consecutive better -> triggered", c5b.triggered === true && c5b.direction === "better");
check("cal: 'better' widens range down (offset < 0)", c5b.offset < 0);

const c5w = calibrationOffset(calToday, mkLogs(5, "worse"));
check("cal: 5 consecutive worse -> offset > 0", c5w.triggered === true && c5w.offset > 0);

check("cal: 4 consecutive -> not triggered", calibrationOffset(calToday, mkLogs(4, "better")).triggered === false);

// mixed direction, <80% share, no 5-run -> not triggered (variable, not miscalibrated)
const interleaved = Array.from({ length: 10 }, (_, i) => {
  const d = new Date(calToday); d.setDate(d.getDate() - i);
  return { date: isoDate(d), readiness: 66, direction: (i % 2 === 0 ? "better" : "worse") };
});
check("cal: mixed <80% and no run -> not triggered", calibrationOffset(calToday, interleaved).triggered === false);

// bounded: lots of consistent logs cap at CAL_MAX
check("cal: offset capped at CAL_MAX", Math.abs(calibrationOffset(calToday, mkLogs(20, "better")).offset) === CAL_MAX);

// the offset feeds auto-detection: a 'better' baseline spares a borderline morning
setData(steady(72, 70));
check("auto+offset: borderline morning softens at offset 0", autoSoftenToday(0) === true);
check("auto+offset: 'better' calibration spares it", autoSoftenToday(-CAL_MAX) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
