# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/X-Saikat-93/embermeter/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/X-Saikat-93/embermeter/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/X-Saikat-93/embermeter/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/X-Saikat-93/embermeter/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/X-Saikat-93/embermeter/releases/tag/v1.0.0
