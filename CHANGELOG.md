# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.0] - 2026-11-02

Eight new instruments for the questions a long session raises. Is the prompt cache still warm? Which MCP servers cost tokens without being called? What would the same work cost on a cheaper model? What did the last compaction drop? Did the tests pass? What is still running in the background? What is not yet committed? The terminal pane is also redrawn, with the ember as its mark. A review of the new code found ten bugs, and all of them are fixed in this release.

### Highlights
- **Know before the cache goes cold.** A live countdown from each reply shows when the prompt cache expires and the next prompt pays to write it again. It learns when your account keeps the cache for an hour.
- **See what you pay for and never use.** MCP servers whose tools ride along in every request without a single call are listed, with their token cost and how many sessions in a row they have sat idle.
- **A pane that looks like an instrument.** Thin gradient meters with red-line limits, two-row charts, pills and dotted leaders, led by the ember mark, which glows while work runs. Nothing moves when idle.
- **Compactions you can trust.** Only real compactions of the main conversation are counted. They are still seen when a managed plugin keeps the compaction event from Embermeter.

### Added
- **Cache warmth:** a countdown from each reply to when the prompt cache goes cold, in the strip, the header, the status line and the report. It switches to an hour once a reply after more than five idle minutes finds the cache still warm. `cacheAlert` (off by default) toasts a minute before, when the window holds 20k tokens or more.
- **Loaded, never called:** MCP servers whose tools sit in every request without a call, with their token cost and their run of unused sessions, on the Context tab, plus a tip to disconnect them.
- **Same tokens, cheaper model:** the main thread's turns repriced at Sonnet 5.5 and Haiku 5.5 list prices (Haiku's 5x rate over 100k tokens included), on the Spend tab and in the report. Turns a subagent was running during are left out, since their cost includes tokens the board never sees.
- **Last compaction:** tokens before and after, the trigger, and the files and tools that had been feeding the window, on the Context tab and in the report.
- **Test runs:** passed and failed counts from Jest, Vitest, pytest, Mocha, cargo, go, `node --test`, RSpec and PHPUnit, with PASS and FAIL pills and the failing trend, on the Tools tab.
- **By branch:** spend, sessions and turns per git branch across sessions, on the Spend tab and in the report.
- **Background jobs:** Claude's background Bash commands, until their end notice arrives or they are stopped, on the System tab and in the status line, with an alert when one is still running two minutes after its turn.
- **Since the last commit:** files Claude changed in the project since the branch last moved, read from git's own files with `fs.stat` (no git process), in the header, with a tip after half an hour with five or more, and another for files changed six or more times.

### Changed
- **The terminal pane is redrawn.**
  - Section labels in capitals on a rule that fades from the accent.
  - Thin gradient meters (`━━━╸───`) with a red line (`┊`) at the compaction point, the temperature limit, the battery floor and the memory limit.
  - Two-row bar charts for trends, cost per turn, the 30 days and the thermal trend.
  - Pills for the grade, test results and failing streaks, and dotted leaders for file and server lists.
  - While work runs, the rules of the live sections shimmer along with the meters. Nothing moves when idle.
- **The ember is the mark.** The header leads with the ember (`◉` in the terminal, the session card's sun in SVG), which glows while work runs. The grade sits beside the name as a labelled badge (`grade [B] 79/100`), where it used to read as a "B" logo. The strip's grade is a filled badge.

### Fixed
- **Compactions:** counted once, and only the main conversation's compactions that stood. A `precompute`, a skipped compaction or a subagent's compaction no longer bumps the count or re-arms the context alerts. When another plugin seated outermost (such as a managed security plugin) sends `session.compact` past Embermeter, a context window that falls to half or less from 20k tokens or more is read as a compaction, shown as `detected`.
- **Background jobs:**
  - A subagent's background commands, and ones that end with their caller's answer, are no longer listed as running forever.
  - A prompt carrying several task notifications closes every job it names.
  - The System tab no longer animates while idle because a dev server is running.
- **Test runs:**
  - A run that exits non-zero shows as failed, so a suite that did not load, a pytest error or a coverage floor no longer gets a green PASS.
  - `./gradlew test`, `vendor/bin/phpunit`, `./node_modules/.bin/jest`, `bundle exec rspec`, `python -m unittest`, `just test` and `cargo nextest` are recognised.
  - The shell's `test -f` no longer counts as a test run.
- **Since the last commit:** only edits that ran count, not denied or failed ones, and only files inside the project. A commit made from another terminal while Claude is idle clears the count within 15 seconds.
- **Cache warmth:** a turn that compacted part-way no longer switches the cache lifetime to an hour for good, which had delayed the cache alert by up to 55 minutes.
- **Same tokens, cheaper model:** turns a background subagent was still spending during are left out, so the saving is no longer overstated.
- **Sessions:** `/embermeter reset` no longer counts as a new session in the branch, MCP and history stats. `/clear` starts the board over instead of carrying the old conversation's jobs, tests and cache countdown.
- **Report:** reads "Prompt cache: warm, 4m00s left" or "cold" instead of "cache cache cold left".
- **Alerts:** keys for an earlier turn's cache countdown or an ended job are dropped instead of piling up for the whole session.

### Security
- SVG attribute values escape double quotes, so a `"` in text placed in an attribute such as `aria-label` can no longer end it early. Flagged by code scanning.
- The release workflow reads the repository by default. Only the job that publishes the release can write.

### Upgrading
- Run `claude plugin update embermeter@embermeter`, then `/reload-plugins` in a running session.
- Nothing to configure. Boards and lifetime totals stored by 1.3.0 gain the new fields the first time they are read. `cacheAlert` is the only new setting, and it is off by default.
- The cheaper-model comparison uses list prices published in October 2026, kept in `hooks/core.ts`. They are an estimate, not a bill.

## [1.3.0] - 2026-11-01

### Added
- **Terminal graphics.** The CLI pane and strip are drawn in coloured cells: heat-gradient meters with eighth-cell precision, sparklines coloured by height, a stacked context bar, swimlanes and a file heatmap. `terminalDrawing: text` keeps plain lines.
- **Terminal motion.** While work runs, a spinner turns, the grade pulses and a highlight sweeps the live meters and agent lanes, about 7 frames a second. Only the blocks that move are repainted, and nothing is sent while idle or with `motion` other than `smooth`.
- **Why it costs what it does:** the priciest recent turn and the files and tools that fed it, with plain tips, on the Overview and in the report.
- **Read again:** files read more than once and the tokens the repeats cost.
- **Failing in a row:** tools whose latest calls failed back to back.
- **Tokens per subagent** on the swimlanes.
- **Session history:** the last 20 sessions with grade, length, turns, calls, cost and branch, on the Spend tab.
- **Turn-cost stop** (`turnBudgetUsd`) and **loop breaker** (`loopBreak`): opt-in guards that refuse tool calls once a turn passes a cost, or a third identical call in a row.
- **Heat guard options:** `pauseOnBattery` and `maxMemPct`.
- **Contrast theme** (`theme: contrast`) for low vision and bright rooms (#1).
- `/embermeter export` copies the session as JSON, `/embermeter csv` one row per turn.
- **Status line presets** (`statusLine`): `full`, `minimal`, `cost` or `off`.
- Hover tooltips on turn bars in the desktop app.

### Fixed
- The heat guard no longer treats arguments as commands: `grep -n "test"` or `git commit -m "fix the build"` stay light. It judges each part of a command line by its command word, plus the subcommand for runners like `npm` or `cargo`.
- Wrappers no longer hide a heavy job from the heat guard: `bash -c "npm test"`, `timeout 600 npm test`, `sudo -u ci docker build` and `(cd app && npm run build)` are judged by the command they run.
- The heat guard and the heat alert use the lower of the last two temperature readings, so one spiky sample no longer holds jobs. A missing reading counts as unknown, never as an old one.

## [1.2.1] - 2026-11-01

### Fixed
- **Terminal pane and strip were blank.** The terminal has no `Svg`, yet the drawing table still hands one back that draws nothing, so the pane and the strip above the prompt showed empty in the CLI. On the terminal every tab, the header and the strip are now drawn as text: block meters, sparklines, tables and swimlanes, from the same numbers as the pictures.
- When the pane cannot open on start (the terminal seats an unasked pane only from 144 columns), a toast now says `/embermeter` opens it.

## [1.2.0] - 2026-11-01

### Added
- **Rate-limit forecast:** each window shows when it fills at the current pace, if that comes before its reset, with an alert 30 minutes out.
- **Compaction warning** two turns before auto-compact.
- **Daily budget** (`dailyBudgetUsd`) across sessions, with alerts at 80% and 100%.
- **Long-turn watch** (`longTurnMin`, default 10 minutes): a nudge when one turn runs long, naming its last tool call.
- **Heaviest files:** the context each file's reads and edits fed, on the Context and Files tabs and in the report.
- **Week over week** spend on the Spend tab and in the report.
- **Git branch** in the header and the report, read from `.git/HEAD` without running git.
- **Session card:** `/embermeter card` or the **Copy card** button copies a shareable SVG summary.
- **Quiet hours** (`quietHours`, for example `22-7`): no toasts at night; alerts are still logged.
- A release workflow: pushing a `vX.Y.Z` tag publishes the release from its changelog section.
- A social preview image, `docs/social-preview.jpg`.

### Changed
- The README explains installing from the VS Code extension, whose chat has no `/plugin` command, and how to update or remove the plugin.

## [1.1.0] - 2026-11-01

### Added
- **Spend** tab (key `3`): a cost waterfall turn by turn with the budget line, cost and tokens split by model, and a 30-day calendar of spend.
- **Loop watch:** flags the same call repeated back to back, or the same call failing again and again. It raises an alert and costs 15 health points while it lasts.
- **Context fed by tools:** an estimate of how many tokens each tool's results put back into the window, on the Tools and Context tabs and in the report.
- Budget runway ("~N turns of budget left") and a budget alert at 50%.
- **Washi** theme (`theme: washi`): rice paper, sumi ink and a vermilion signal, with matcha and indigo.
- Daily totals in the lifetime store (last 60 days), shown on the Spend tab, the pane footer and in the report.

### Changed
- The README art and screenshots are redrawn in the washi style: paper grain, a vermilion sun dial, ink mountains, ensō section marks and a hanko seal.
- Washi is the default theme. Set `theme: night` for the previous look.
- Tabs are now Overview, Context, Spend, Tools, Files, Agents, System and Log, on keys `1`–`8`.

## [1.0.0] - 2026-11-01

First public release.

### Added
- Live pane with seven tabs: Overview, Context, Tools, Files, Agents, System and Log. Keys `1`–`7` switch tabs.
- Arc gauges with red-line markers for context (auto-compact point), cost (budget), cache hit and CPU temperature.
- Context composition by category, with the always-loaded memory files and MCP tools and their token cost.
- Runway forecast: turns left before auto-compact.
- Token analytics: fresh input, cache read and write, output, cache-hit rate, output speed and model per turn.
- Cost per hour and per turn, an optional budget, and every rate-limit window with its reset countdown.
- Live flow diagram (Prompt → Model → Gate → Tools → Subagents) with particles on active links.
- Tool leaderboard with success share, average and p95. File heatmap. Subagent swimlanes that open transcripts.
- Health grade A–F, with its reasons.
- Heat guard: holds heavy Bash jobs while the CPU is hot or the battery is low.
- Optional command-prefix compliance meter.
- Strip above the prompt, status-line summary and toast alerts.
- `/embermeter` command with `report`, `copy`, `reset`, `close` and tab names.
- Night and day palettes, `motion` setting (smooth, reduced, off), and a responsive narrow layout.
- Lifetime totals across sessions.

### Security
- No network, no file writes, no processes. Every hook fails open. All SVG text is escaped.

[Unreleased]: https://github.com/X-Saikat-93/embermeter/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/X-Saikat-93/embermeter/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/X-Saikat-93/embermeter/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/X-Saikat-93/embermeter/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/X-Saikat-93/embermeter/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/X-Saikat-93/embermeter/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/X-Saikat-93/embermeter/releases/tag/v1.0.0
