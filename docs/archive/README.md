# Archive

Historical documents that are no longer current but still carry context. They are **not maintained**: code paths, versions and line numbers inside them describe the state at the time they were written. Each file keeps its git history (`git log --follow`).

| File | What it is | Why archived | Last commit before the move |
|---|---|---|---|
| [ToFixPlan.md](ToFixPlan.md) | Phase-by-phase fix plan for the June 2026 audit (41 findings). Its source list, `ToFixFehler.md`, was never committed (it is gitignored and only exists on the author's machine). | Executed; superseded by `CHANGELOG.md` and the issue tracker. | `c877802` (2026-06-17) |
| [RoadToDeploy.md](RoadToDeploy.md) | Google Play Store feasibility study for the native Android app. | The Android app is frozen (EOL, #372) and was never submitted. Still useful when resuming, see [android-wieder-aufnehmen.md](../android-wieder-aufnehmen.md). | `adafcae` (2026-07-31) |

Moved in #380. The GitHub Pages workflow ignores changes under this directory.
