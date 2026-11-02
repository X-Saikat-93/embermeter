# Contributing to Embermeter

Thanks for helping. This guide covers setup, the rules the code follows, and how a change gets merged.

## Setup

You need Claude Code 2.1.287 or later and Node 22.18+ (only for regenerating the README images).

```sh
git clone https://github.com/X-Saikat-93/embermeter && cd embermeter
claude --plugin-dir .
```

That session loads Embermeter from the folder, and each edit hot-reloads it when the turn ends. On first load the engine writes editor types to `.claude-plugin/types/` (gitignored), so after that:

```sh
npx tsc -p .                 # type-check
claude plugin validate .     # manifest, hooks and state contract
claude plugin test .         # unit tests + UI tests on vscode, desktop and terminal
node scripts/render-docs.ts  # regenerate docs/*.svg from the real drawing code
node scripts/render-art.ts   # regenerate the README art in docs/art/
```

## Layout

| Path | Role | Rules |
|---|---|---|
| `hooks/core.ts` | State, analytics, formatting | Pure: no `$`, no I/O. Every function is testable. |
| `hooks/draw.ts` | Design system and SVG builders | Pure strings. Colours only from `PALETTES`. Text only through `txt()`. |
| `hooks/term/segments.ts` · `pages.ts` · `raster.ts` | The terminal's drawing: coloured segments, what each tab says, and the cell encoding with motion | Pure: no `$`. Numbers come from `core.ts`, so the terminal and the SVG pages always agree. Every line is clipped with `fit()`; every glyph goes through `safeGlyph()`. |
| `hooks/term/view.tsx` | Mounting terminal blocks and the frame loop | Touches `$` only to blit frames. A function that takes `$` from another file must be a `function` declaration, which the engine requires. |
| `hooks/register.tsx` | Engine wiring: hooks, sensors, commands, pane | Owns every event hook. Every hook ends in `.catch(($, e, next) => next(e))`. The engine allows one matcher-less hook per event, so related guards share one. |
| `types/index.d.ts` | The `$.state` contract | Add a field here before you store it. Make it optional or handle it in `normalize()`, so older stored boards still load. |
| `tests/` | `core.test.ts` (logic), `instruments.test.ts` (the cache, MCP, what-if, tests, jobs, branch and commit instruments), `draw.test.ts` (pages and escaping), `term.test.ts` (cells, motion, widths), `pane.test.tsx` (UI on every surface, guards, commands) | New logic gets a test. |
| `scripts/render-docs.ts` | Panel screenshots for the README | Uses the same sample session for every image. |
| `scripts/render-art.ts` | README art: hero, section plates, cluster, spec sheet, sign-off | Colours come from `PALETTES`; keep the operator's-manual voice. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow.

## Rules that keep it trustworthy

1. **Fail open.** A fault in Embermeter must never block a prompt or a tool. The heat guard is the one deliberate exception.
2. **No network and no writes.** No `fetch`, no `$.process`, no `$.model`, no files written. A feature that needs any of these needs an issue and a discussion first.
3. **No dependencies.** The mod ships as source.
4. **Escape everything drawn.** User-controlled text (paths, commands, agent names) reaches SVG only through `txt()`.
5. **Validator rule:** `$` may only be passed to top-level functions, not to closures defined inside `register`.

## Design rules

- **Palette:** amber is the one signal colour. Sage means good, rust means bad, steel and sand are neutral series. No new hues without a reason, and no gradients for decoration.
- **Motion:** a loop runs only while the thing it shows is working. Value changes ease from the previous reading (`ease()`). Everything must look right with `motion: off`.
- **Layout:** check both widths (`drawContext(cfg, prev, 90)` and `50`) and both themes.
- **Numbers:** use mono or tabular figures and fixed widths, so values don't jitter.

## Pull requests

- Keep each PR to one change, and use a [Conventional Commit](https://www.conventionalcommits.org) title (`feat:`, `fix:`, `docs:`…).
- For visual changes, include screenshots in night and day, and narrow if the layout moved.
- Add a line to `CHANGELOG.md` under *Unreleased*.
- CI must be green: validate, tests and the docs render.

## Releasing (maintainers)

1. Move *Unreleased* in `CHANGELOG.md` to the new version.
2. Bump `version` in `.claude-plugin/plugin.json`.
3. Push a `vX.Y.Z` tag. The `release` workflow checks that the changelog section and the version match, then publishes the GitHub release with that section as its notes.

By contributing you agree your work is released under the [MIT License](LICENSE), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
