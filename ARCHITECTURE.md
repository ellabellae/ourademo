# Architecture — stress-aware recovery dashboard

Status: built (demo). Single-user, static, no backend.
Companion docs: [README.md](README.md) (how to run), mission-alignment memo (why it's on-brand for Oura).

## 1. Goal and constraints

Build a personal Oura dashboard that softens how Readiness/Sleep are shown during a
self-set stress window, as a working demo and a portfolio piece. Constraints that
shaped every decision:

- **Single user, no accounts, no backend.** It's your data on your machine.
- **Must demo offline.** It has to render in front of an interviewer with no token and
  no wifi.
- **Self-contained output.** One file you can double-click or host on GitHub Pages.
- **No third-party Python packages.** Standard library only, so `python build.py` just
  works.

## 2. Component map

```
            BUILD TIME (Python)                     VIEW TIME (browser, no server needed)
   ┌─────────────────────────────────┐       ┌──────────────────────────────────────────┐
   │ build.py                         │       │ index.html  (self-contained)              │
   │                                  │       │                                            │
   │  OURA_TOKEN set?                 │       │  OURA_DATA  (inlined at build)             │
   │   ├ yes → Oura API v2 ──┐        │       │  stressEvents  ← localStorage (per-device) │
   │   │   daily_readiness   │        │       │       + ephemeral ?demo event              │
   │   │   daily_sleep       ├─ merge │       │                                            │
   │   │                     │  by day│  ──►  │  today = new Date()  (local)               │
   │   └ no / error → sample_data.json│       │  view-mode state machine (§4)              │
   │                                  │       │  render: scores · trend · events · form    │
   │  inline JSON into template.html  │       │                                            │
   │  → write index.html              │       └──────────────────────────────────────────┘
   └─────────────────────────────────┘
       data.json (real, gitignored)              No network calls at view time.
       sample_data.json (committed)              All data is inlined; localStorage is local.
```

Build time and view time are fully decoupled. The build decides *what data*; the browser
decides *how to present it* against today's date. That split is deliberate: it keeps the
stress-window logic correct no matter when you open the file, and keeps secrets (the
token, real data) out of the committed artifact.

## 3. Data flow

```
Oura API ──┐
           ├─(build.py merges readiness+sleep by day)──► [{day, readiness, sleep}] × 14
sample ────┘                                                      │
                                                                  ▼
                                          inlined as `const OURA_DATA` in index.html
                                                                  │
   user logs events ──► localStorage `ourademo.stressEvents` ─────┤
   (in-page form)                                                 ▼
                                          render() computes view mode from (today, events)
```

### Data model

```
OuraDay      { day: "YYYY-MM-DD", readiness: 0-100|null, sleep: 0-100|null }
StressEvent  { id: string, date: "YYYY-MM-DD", type: ExamType, demo?: bool }
ExamType     "exam" | "presentation" | "deadline" | "competition" | "other"
```

Events are stored client-side only. `id` is a random base36 string for stable removal.
The `demo` flag marks the ephemeral `?demo` event so it isn't given a remove button and
is never written to localStorage.

## 4. View-mode state machine

```
                 load / add event / remove event / ?demo
                              │
                              ▼
                 today = local midnight
                 events = localStorage (+ demo event if ?demo)
                              │
            any event with (today - event) ∈ [-2, +1] days ?
                  │                                  │
                 yes                                no
                  ▼                                  ▼
        ┌───────────────────┐              ┌───────────────────┐
        │ SOFTENED          │              │ NORMAL            │
        │ • reframe banner  │              │ • raw scores      │
        │   (by event type) │              │ • Δ vs yesterday  │
        │ • all scores blur │              │ • 14-day trend    │
        │   (uniform)       │              │ • trend           │
        │ • tap-to-reveal   │              │ • events + form   │
        │ • signpost note   │              └───────────────────┘
        └───────────────────┘
```

Window = `[event − STRESS_BEFORE, event + STRESS_AFTER]`, currently `[−2, +1]` days,
inclusive. Constants live at the top of the `<script>` in `template.html`.

## 5. Anti-leak invariants (the part that matters)

These come straight from the mission-alignment memo. They are load-bearing, not polish.
If a future change breaks one, the feature stops being honest:

1. **Uniform softening.** In a stress window, *every* score blurs, not only low ones.
   `setScore()` applies the blur regardless of value. If only low scores blurred, the
   blur itself would leak that the score is bad.
2. **Reframe keys off event type only.** The supportive message is chosen from
   `EVENT_TYPES[ev.type]`, never from the score. The presentation of softening must not
   encode the hidden number.
3. **Softened, not hidden.** Always a tap-to-reveal and an explicit signpost
   ("softened, not hidden — tap any score to see the exact number"). The user always
   knows data is being reframed.
4. **Opt-in.** Nothing softens unless the user logs an event. No default-on softening.

Invariants 1–2 are verified structurally by `test_logic.js`; 3–4 are verified by reading
`renderSignpost`/`render`.

## 6. Failure modes

| Codepath | Failure | Handled? | User sees |
|---|---|---|---|
| `build.py` Oura fetch | bad/expired token, network down, API 5xx | yes — caught, falls back to sample | stderr note; demo still builds |
| `build.py` Oura fetch | token valid but zero days returned | yes — falls back to sample | stderr note |
| `index.html` localStorage | corrupt/old JSON | yes — `loadEvents` try/catch → `[]` | normal mode, no crash |
| `index.html` data | a day missing readiness/sleep (`null`) | yes — `setScore` shows `--`, trend bar height 0 | `--`, no crash |
| `index.html` data | empty `OURA_DATA` | yes — guards in `renderScores`/`renderTrend` | `--`, empty trend |
| view-mode | overlapping stress windows | yes — first match wins, still softened | softened |

No known failure mode is both silent and unhandled.

## 7. What already exists / reused

- **Oura API v2** (`daily_readiness`, `daily_sleep`) — used directly, no wrapper SDK.
- **Python stdlib** `urllib` for HTTP, `json`, `datetime` — no `requests`, no pip.
- **Browser `localStorage`** for event persistence — no DB, no server.

Nothing here is rebuilt that a platform already provides.

## 8. NOT in scope (deliberately deferred)

- **Calendar auto-pull** of stress events — the long-term vision (§9), but far more
  plumbing than a demo needs. Manual in-page logging covers the demo.
- **Cross-device sync** — localStorage is per-browser/per-device. Acceptable for a
  single-user demo; would need a backend or file-based events to fix.
- **Auth / multi-user** — out of scope by design.
- **Configurable window length in the UI** — constants in source for now; no settings
  panel.
- **Historical "what did this day look like" replay** — only the latest day's scores are
  shown as cards.
- **Automated visual/E2E test in CI** — logic is unit-tested headlessly; pixel
  verification is manual for now.

## 9. Future architecture (when it grows past a demo)

```
            ┌──────────────┐      ┌──────────────────┐
 Calendar ──►  events      │      │  small backend    │  ── optional, only if multi-device
  API        │  source     ├──────►  (events store,   │
            └──────────────┘      │   token vault)    │
 manual log ─┘                    └──────────────────┘
```

The build-time/view-time split means swapping the event source (localStorage →
calendar API → backend) touches only how `events` is loaded in `render()`. The
softening logic and anti-leak invariants stay put. That's the main reason to keep them
decoupled.

## 10. Demo

- `index.html` — normal mode (no events logged).
- `index.html?demo` — seeds an ephemeral exam event for today so the softened view
  shows immediately, without writing to localStorage. Use this for portfolio links /
  GitHub Pages.
- Manual path: open `index.html`, add an event dated today, watch it flip to softened,
  tap a score to reveal.
