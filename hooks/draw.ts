// SVG drawing: pure string builders, no `$`.
// Motion is SMIL only (it runs in VS Code's image mode, no script): value changes ease in,
// and loops (particles, breathing) run only while the stage they show is working.
import type { Board, Lifetime, Limit, Turn } from '../types'
import type { Cfg, Motion, Theme } from './core'
import {
  budgetRunway,
  cacheHit,
  compactPct,
  compliance,
  costRate,
  ctxWeight,
  dayKey,
  dur,
  fileBoard,
  fileWeight,
  forecast,
  health,
  kfmt,
  lastDays,
  limitEta,
  modelSplit,
  money,
  short,
  shortPath,
  throughput,
  toolBoard,
  until,
  weekCompare,
  insights,
  rereads,
  streaks,
} from './core'

// ---------------------------------------------------------------- design tokens

// Instrument palettes: warm ink at night, paper by day, and washi (rice paper, sumi ink, a vermilion sun).
// One signal color each, muted semantics, no neon. Each SVG paints its own ground, so it reads on any editor theme.
export type Pal = {
  ground: string
  panel: string
  line: string
  grid: string
  ink: string
  sub: string
  faint: string
  amber: string
  sage: string
  steel: string
  sand: string
  rust: string
  rose: string
}

export const PALETTES: Record<Theme, Pal> = {
  night: {
    ground: '#121110',
    panel: '#1a1917',
    line: '#2d2b27',
    grid: '#23211e',
    ink: '#ece5d8',
    sub: '#a29a8c',
    faint: '#6c655b',
    amber: '#e2a23c',
    sage: '#93ae7e',
    steel: '#87a3b6',
    sand: '#c7b089',
    rust: '#d4644e',
    rose: '#b98c86',
  },
  day: {
    ground: '#f3efe6',
    panel: '#fbf9f4',
    line: '#ddd5c6',
    grid: '#ebe5d8',
    ink: '#1e1b17',
    sub: '#6a6256',
    faint: '#a1988a',
    amber: '#a8680f',
    sage: '#52773f',
    steel: '#3c6380',
    sand: '#86703f',
    rust: '#ad412c',
    rose: '#8e5d58',
  },
  // Vermilion (shu) is the signal; matcha for good, indigo (ai) for neutral, deep crimson (beni) for trouble.
  washi: {
    ground: '#ebe2cf',
    panel: '#f3ecdd',
    line: '#d5c8ae',
    grid: '#e2d7c1',
    ink: '#1d2124',
    sub: '#59544d',
    faint: '#958b7c',
    amber: '#cc3b2e',
    sage: '#5d7848',
    steel: '#34536b',
    sand: '#97794c',
    rust: '#86201b',
    rose: '#b36d66',
  },
  // High contrast for low vision and bright rooms: near-black ground, every text colour at least 7:1 on it.
  contrast: {
    ground: '#000000',
    panel: '#0d0d0d',
    line: '#7a7a7a',
    grid: '#2e2e2e',
    ink: '#ffffff',
    sub: '#e0e0e0',
    faint: '#b3b3b3',
    amber: '#ffd400',
    sage: '#3ee08a',
    steel: '#7cc8ff',
    sand: '#ffd08f',
    rust: '#ff6b5e',
    rose: '#ffa8b8',
  },
}

const SANS = `Inter, 'Segoe UI', ui-sans-serif, system-ui, sans-serif`
const MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace`

// easeOutQuint for transitions, easeInOutSine for loops.
const OUT = 'calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"'
const INOUT2 = 'calcMode="spline" keyTimes="0;0.5;1" keySplines="0.37 0 0.63 1;0.37 0 0.63 1"'

export type Draw = { p: Pal; motion: Motion; prev: Board | null; W: number }

export const drawContext = (cfg: Cfg, prev: Board | null, bodyColumns: number | undefined): Draw => ({
  p: PALETTES[cfg.theme],
  motion: cfg.motion,
  prev,
  // Wide from ~76 columns; below that every page re-flows to a single narrow column.
  W: bodyColumns !== undefined && bodyColumns < 76 ? 400 : 640,
})

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clamp = (f: number) => Math.max(0, Math.min(1, f))
const r1 = (n: number) => n.toFixed(1)

const level = (D: Draw, f: number) => (f < 0.6 ? D.p.sage : f < 0.82 ? D.p.amber : D.p.rust)

// A transition from the previous render's value; nothing when unchanged or motion is off.
const ease = (D: Draw, attr: string, from: number | null | undefined, to: number, ms = 700) =>
  D.motion === 'off' || from == null || Math.abs(from - to) < 0.05
    ? ''
    : `<animate attributeName="${attr}" values="${r1(from)};${r1(to)}" dur="${ms}ms" fill="freeze" ${OUT}/>`

const loops = (D: Draw) => D.motion === 'smooth'

const breathe = (D: Draw, attr: string, lo: number, hi: number, s = 2.4) =>
  loops(D) ? `<animate attributeName="${attr}" values="${lo};${hi};${lo}" dur="${s}s" repeatCount="indefinite" ${INOUT2}/>` : ''

type T = { size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; mono?: boolean; caps?: boolean; opacity?: number }

const txt = (D: Draw, x: number, y: number, s: string, o: T = {}) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.size ?? 11}" fill="${o.color ?? D.p.sub}"` +
  ` font-family="${o.mono ? MONO : SANS}"${o.mono ? ' style="font-variant-numeric:tabular-nums"' : ''}` +
  (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
  (o.weight ? ` font-weight="${o.weight}"` : '') +
  (o.caps ? ' letter-spacing="0.09em"' : '') +
  (o.opacity !== undefined ? ` opacity="${o.opacity}"` : '') +
  `>${esc(o.caps ? s.toUpperCase() : s)}</text>`

const label = (D: Draw, x: number, y: number, s: string, anchor?: 'start' | 'middle' | 'end') => txt(D, x, y, s, { size: 8.5, caps: true, weight: 600, anchor, color: D.p.faint })

const svg = (D: Draw, h: number, body: string, w = D.W) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="14" fill="${D.p.ground}"/>${body}</svg>`

const panel = (D: Draw, x: number, y: number, w: number, h: number, title: string, right = '') =>
  `<rect x="${r1(x + 0.5)}" y="${r1(y + 0.5)}" width="${r1(w - 1)}" height="${r1(h - 1)}" rx="10" fill="${D.p.panel}" stroke="${D.p.line}"/>` +
  label(D, x + 14, y + 20, title) +
  (right ? txt(D, x + w - 14, y + 20, right, { size: 9.5, anchor: 'end', color: D.p.sub }) : '')

// A hover tooltip for one turn's bar; drawn where the SVG is interactive (the desktop app).
const tip = (t: Turn) =>
  `<title>${esc([`${dur(t.ms)} · ${t.tools} tools · ${t.usd !== null ? money(t.usd) : 'cost –'}`, t.model, t.reason !== 'answer' ? t.reason : '', t.fed?.length ? `fed by ${t.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(', ')}` : ''].filter(Boolean).join('\n'))}</title>`

type Note = { t: string; right?: string; color?: string }

// A titled panel of plain rows, for instruments that read as a list rather than a chart.
const notes = (D: Draw, y: number, title: string, right: string, rows: Note[]) => {
  const h = 38 + rows.length * 19
  const cut = D.W >= 600 ? 92 : 58
  const body =
    panel(D, 0, y, D.W, h, title, right) +
    rows
      .map((r, i) => {
        const ry = y + 42 + i * 19
        return txt(D, 14, ry, short(r.t, r.right ? cut - 14 : cut), { size: 10, color: r.color ?? D.p.ink }) + (r.right ? txt(D, D.W - 14, ry, r.right, { size: 10, mono: true, anchor: 'end' }) : '')
      })
      .join('')
  return { h, body }
}

const dot = (D: Draw, cx: number, cy: number, color: string, live: boolean, r = 3.5) =>
  (live && loops(D)
    ? `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2">` +
      `<animate attributeName="r" values="${r};${r + 7}" dur="1.8s" repeatCount="indefinite" ${OUT}/>` +
      `<animate attributeName="opacity" values="0.8;0" dur="1.8s" repeatCount="indefinite" ${OUT}/></circle>`
    : '') + `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="${color}"/>`

// A horizontal meter with an eased fill.
const meter = (D: Draw, x: number, y: number, w: number, f: number | null, prevF: number | null | undefined, color: string, h = 5, marker?: number) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="${h / 2}" fill="${D.p.grid}"/>` +
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(clamp(f ?? 0) * w)}" height="${h}" rx="${h / 2}" fill="${color}">${ease(D, 'width', prevF == null ? null : clamp(prevF) * w, clamp(f ?? 0) * w)}</rect>` +
  (marker !== undefined ? `<rect x="${r1(x + clamp(marker) * w - 1)}" y="${r1(y - 3)}" width="2" height="${h + 6}" rx="1" fill="${D.p.rust}"/>` : '')

// ---------------------------------------------------------------- instruments

// An avionics arc gauge: 240 degrees, tick marks, an eased value arc and an optional red-line marker.
const pt = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)] as const

export type Gauge = { label: string; value: string; sub: string; f: number | null; prev?: number | null; color: string; redline?: number; live?: boolean }

const gauge = (D: Draw, cx: number, cy: number, r: number, g: Gauge) => {
  const [sx, sy] = pt(cx, cy, r, 150)
  const [ex, ey] = pt(cx, cy, r, 30)
  const d = `M ${r1(sx)} ${r1(sy)} A ${r} ${r} 0 1 1 ${r1(ex)} ${r1(ey)}`
  const len = (r * 240 * Math.PI) / 180
  const f = clamp(g.f ?? 0)
  let ticks = ''
  for (let i = 0; i <= 12; i++) {
    const a = 150 + i * 20
    const [x1, y1] = pt(cx, cy, r + 7, a)
    const [x2, y2] = pt(cx, cy, r + (i % 3 === 0 ? 11 : 9), a)
    ticks += `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${D.p.faint}" stroke-width="${i % 3 === 0 ? 1.2 : 0.8}" opacity="0.7"/>`
  }
  let red = ''
  if (g.redline !== undefined) {
    const a = 150 + clamp(g.redline) * 240
    const [x1, y1] = pt(cx, cy, r - 6, a)
    const [x2, y2] = pt(cx, cy, r + 12, a)
    red = `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${D.p.rust}" stroke-width="2" stroke-linecap="round"/>`
  }
  const from = g.prev == null ? null : clamp(g.prev) * len
  return (
    ticks +
    `<path d="${d}" fill="none" stroke="${D.p.grid}" stroke-width="6" stroke-linecap="round"/>` +
    (g.f === null
      ? ''
      : `<path d="${d}" fill="none" stroke="${g.color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${r1(f * len)} ${r1(len)}">` +
        (from !== null && Math.abs(from - f * len) > 0.5 && D.motion !== 'off'
          ? `<animate attributeName="stroke-dasharray" values="${r1(from)} ${r1(len)};${r1(f * len)} ${r1(len)}" dur="800ms" fill="freeze" ${OUT}/>`
          : '') +
        (g.live ? breathe(D, 'stroke-opacity', 0.65, 1) : '') +
        `</path>`) +
    red +
    txt(D, cx, cy + 5, g.value, { size: r > 30 ? 17 : 14, weight: 600, mono: true, anchor: 'middle', color: D.p.ink }) +
    label(D, cx, cy + r * 0.62 + 10, g.label, 'middle') +
    (g.sub ? txt(D, cx, cy + r * 0.62 + 23, g.sub, { size: 9.5, anchor: 'middle', mono: true }) : '')
  )
}

const gauges = (D: Draw, y: number, title: string, right: string, list: Gauge[]) => {
  const perRow = D.W >= 600 ? 4 : 2
  const rows = Math.ceil(list.length / perRow)
  const cell = (D.W - 24) / perRow
  const rowH = 122
  let body = panel(D, 0, y, D.W, 34 + rows * rowH, title, right)
  list.forEach((g, i) => {
    const cx = 12 + cell * (i % perRow) + cell / 2
    const cy = y + 84 + Math.floor(i / perRow) * rowH
    body += gauge(D, cx, cy, 34, g)
  })
  return { h: 34 + rows * rowH, body }
}

// A sparkline with an area wash, an eased last point and an optional red-line.
const spark = (D: Draw, x: number, y: number, w: number, h: number, values: number[], color: string, top?: number, red?: number) => {
  if (values.length < 2) return txt(D, x + w / 2, y + h / 2 + 4, 'collecting…', { size: 10, anchor: 'middle', color: D.p.faint })
  const max = top ?? Math.max(1, ...values)
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => [x + i * step, y + h - clamp(v / max) * h] as const)
  const line = pts.map(([px, py]) => `${r1(px)},${r1(py)}`).join(' ')
  const id = `g${Math.round(x)}${Math.round(y)}`
  const [lx, ly] = pts[pts.length - 1] ?? [x, y]
  let grid = ''
  for (let i = 1; i < 4; i++) grid += `<line x1="${r1(x)}" x2="${r1(x + w)}" y1="${r1(y + (h * i) / 4)}" y2="${r1(y + (h * i) / 4)}" stroke="${D.p.grid}"/>`
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
    grid +
    (red !== undefined
      ? `<line x1="${r1(x)}" x2="${r1(x + w)}" y1="${r1(y + h - clamp(red / max) * h)}" y2="${r1(y + h - clamp(red / max) * h)}" stroke="${D.p.rust}" stroke-dasharray="3 4" opacity="0.8"/>`
      : '') +
    `<polygon points="${r1(x)},${r1(y + h)} ${line} ${r1(x + w)},${r1(y + h)}" fill="url(#${id})"/>` +
    `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
    dot(D, lx, ly, color, true, 2.6)
  )
}

// ---------------------------------------------------------------- flow

const node = (D: Draw, x: number, y: number, w: number, title: string, sub: string, live: boolean, color: string) =>
  `<rect x="${r1(x + 0.5)}" y="${r1(y + 0.5)}" width="${r1(w - 1)}" height="43" rx="8" fill="${D.p.ground}" stroke="${live ? color : D.p.line}"/>` +
  `<rect x="${r1(x + 0.5)}" y="${r1(y + 8)}" width="3" height="28" rx="1.5" fill="${color}" opacity="${live ? 1 : 0.45}">${live ? breathe(D, 'opacity', 0.5, 1, 1.8) : ''}</rect>` +
  txt(D, x + 14, y + 19, title, { size: 10, weight: 700, caps: true, color: live ? D.p.ink : D.p.sub }) +
  txt(D, x + 14, y + 34, sub, { size: 9.5, mono: true })

const wire = (D: Draw, d: string, live: boolean, color: string, n = 3, s = 1.8) => {
  let out = `<path d="${d}" fill="none" stroke="${live ? color : D.p.line}" stroke-width="1.4" opacity="${live ? 0.55 : 1}"/>`
  if (live && loops(D)) {
    for (let i = 0; i < n; i++) {
      out +=
        `<circle r="2.4" fill="${color}"><animateMotion dur="${s}s" begin="-${r1((s / n) * i)}s" repeatCount="indefinite" path="${d}" ` +
        `keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1"/>` +
        `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="${s}s" begin="-${r1((s / n) * i)}s" repeatCount="indefinite"/></circle>`
    }
  }
  return out
}

const flow = (D: Draw, b: Board, y: number) => {
  const p = D.p
  const liveCalls = b.calls.filter(x => x.status === 'run').length
  const liveAgents = b.agents.filter(a => a.status === 'run').length
  const total = Object.values(b.stats).reduce((s, x) => s + x.n, 0)
  const right = `${b.gate.allow} allow · ${b.gate.ask} ask · ${b.gate.deny} deny`
  const ctxSub = b.ctx?.pct != null ? `ctx ${Math.round(b.ctx.pct)}%` : 'ctx –'
  if (D.W >= 600) {
    const ny = y + 34
    const body =
      panel(D, 0, y, D.W, 168, 'Flow', right) +
      wire(D, `M 126 ${ny + 21} L 168 ${ny + 21}`, b.running, p.steel) +
      wire(D, `M 300 ${ny + 21} L 342 ${ny + 21}`, liveCalls > 0, p.amber, 2, 1.2) +
      wire(D, `M 474 ${ny + 21} L 500 ${ny + 21}`, liveCalls > 0, p.amber, 2, 1.0) +
      wire(D, `M 234 ${ny + 44} L 234 ${ny + 60} Q 234 ${ny + 66} 240 ${ny + 66} L 296 ${ny + 66} Q 302 ${ny + 66} 302 ${ny + 72} L 302 ${ny + 76}`, liveAgents > 0, p.sand, 3, 2.2) +
      node(D, 14, ny, 112, 'Prompt', `${b.turnCount} turns`, b.running, p.steel) +
      node(D, 168, ny, 132, 'Model', ctxSub, b.running, p.sage) +
      node(D, 342, ny, 132, 'Gate', `${b.gate.deny} denied`, liveCalls > 0, b.gate.deny ? p.rust : p.steel) +
      node(D, 500, ny, 126, 'Tools', `${liveCalls} live · ${total}`, liveCalls > 0, p.amber) +
      node(D, 236, ny + 76, 136, 'Subagents', `${liveAgents} live · ${b.agents.length}`, liveAgents > 0, p.sand) +
      (b.guardBlocks ? txt(D, D.W - 14, ny + 103, `heat guard held ${b.guardBlocks}`, { size: 9.5, anchor: 'end', color: p.rust }) : '')
    return { h: 168, body }
  }
  // Narrow: a vertical rail.
  const x = 24
  const w = D.W - 48
  const ys = [0, 1, 2, 3].map(i => y + 34 + i * 56)
  const body =
    panel(D, 0, y, D.W, 34 + 4 * 56 + 4, 'Flow', right) +
    wire(D, `M ${x + 40} ${(ys[0] ?? 0) + 44} L ${x + 40} ${ys[1] ?? 0}`, b.running, p.steel) +
    wire(D, `M ${x + 40} ${(ys[1] ?? 0) + 44} L ${x + 40} ${ys[2] ?? 0}`, liveCalls > 0, p.amber, 2, 1.0) +
    wire(D, `M ${x + w - 40} ${(ys[1] ?? 0) + 44} L ${x + w - 40} ${ys[3] ?? 0}`, liveAgents > 0, p.sand, 3, 2.0) +
    node(D, x, ys[0] ?? 0, w, 'Prompt', `${b.turnCount} turns`, b.running, p.steel) +
    node(D, x, ys[1] ?? 0, w, 'Model', ctxSub, b.running, p.sage) +
    node(D, x, ys[2] ?? 0, w / 2 - 6, 'Tools', `${liveCalls} live · ${total}`, liveCalls > 0, p.amber) +
    node(D, x + w / 2 + 6, ys[3] ?? 0, w / 2 - 6, 'Subagents', `${liveAgents} live`, liveAgents > 0, p.sand)
  return { h: 34 + 4 * 56 + 4, body }
}

// ---------------------------------------------------------------- pages

export const header = (D: Draw, b: Board, cfg: Cfg) => {
  const p = D.p
  const h = health(b, cfg)
  const gc = h.grade === 'A' ? p.sage : h.grade === 'B' ? p.steel : h.grade === 'C' ? p.amber : p.rust
  const busy = b.running || b.agents.some(a => a.status === 'run')
  const state = b.running ? `Running ${dur(b.now - b.turnStart)}` : busy ? 'Agents working' : 'Idle'
  const wide = D.W >= 600
  const H = wide ? 64 : 92
  const why = h.reasons.length ? h.reasons.slice(0, 3).join(' · ') : 'all clear'
  let body =
    `<rect x="12" y="12" width="40" height="40" rx="9" fill="none" stroke="${gc}" stroke-width="1.5"/>` +
    txt(D, 32, 39, h.grade, { size: 22, weight: 700, mono: true, anchor: 'middle', color: gc }) +
    txt(D, 64, 29, 'Embermeter', { size: 15, weight: 700, color: p.ink }) +
    txt(D, 64, 46, `${h.score}/100 · ${why}`, { size: 10, color: p.sub })
  const sx = wide ? D.W - 236 : 64
  const sy = wide ? 29 : 72
  body +=
    dot(D, sx, sy - 4, busy ? p.amber : p.faint, busy) +
    txt(D, sx + 12, sy, state, { size: 11, weight: 600, color: busy ? p.amber : p.sub, mono: b.running }) +
    txt(D, D.W - 14, sy, `turn ${b.turnCount} · ${dur(b.now - b.startedAt)}`, { size: 10, anchor: 'end', mono: true }) +
    (wide ? txt(D, D.W - 14, 46, [b.branch ? `on ${short(b.branch, 20)}` : '', b.model ? short(b.model, 28) : 'model –'].filter(Boolean).join(' · '), { size: 9.5, anchor: 'end', color: p.faint, mono: true }) : '')
  return svg(D, H, body)
}

const limitsRow = (D: Draw, b: Board, y: number, limits: Limit[]) => {
  if (!limits.length) return { h: 0, body: '' }
  const prev = D.prev?.ctx?.limits ?? []
  const h = 30 + limits.length * 22
  const etas = limitEta(b)
  let body = panel(D, 0, y, D.W, h, 'Rate limits', 'resets in · or fills in, at this pace')
  limits.forEach((l, i) => {
    const ly = y + 34 + i * 22
    const before = prev.find(x => x.kind === l.kind)?.pct
    const eta = etas.find(e => e.kind === l.kind)?.etaMs ?? null
    body +=
      txt(D, 14, ly + 6, l.kind.replace(/_/g, ' '), { size: 10, color: D.p.ink }) +
      meter(D, 120, ly, D.W - 250, l.pct / 100, before !== undefined ? before / 100 : null, level(D, l.pct / 100), 6) +
      txt(D, D.W - 96, ly + 7, `${l.pct}%`, { size: 10, mono: true, anchor: 'end', color: level(D, l.pct / 100) }) +
      (eta !== null
        ? txt(D, D.W - 14, ly + 7, `full ~${dur(eta)}`, { size: 10, mono: true, anchor: 'end', color: D.p.rust })
        : txt(D, D.W - 14, ly + 7, until(l.resetsAt, b.now) || '–', { size: 10, mono: true, anchor: 'end' }))
  })
  return { h, body }
}

export const overview = (D: Draw, b: Board, cfg: Cfg) => {
  const p = D.p
  const c = b.ctx
  const v = b.vitals
  const f = forecast(b)
  const r = costRate(b)
  const hit = cacheHit(b.tokens)
  const prevHit = D.prev ? cacheHit(D.prev.tokens) : null
  const parts: string[] = []
  let y = 0
  const gap = 10

  const ctxF = c?.pct != null ? c.pct / 100 : null
  const budgetF = cfg.budgetUsd > 0 && c?.usd != null ? c.usd / cfg.budgetUsd : null
  const tF = v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null
  const g = gauges(D, y, 'Vitals', f.turnsLeft !== null ? `~${f.turnsLeft} turns to ${f.ceiling < 100 ? 'compaction' : 'full'}` : '', [
    {
      label: 'Context',
      value: c?.pct != null ? `${Math.round(c.pct)}%` : '–',
      sub: `${kfmt(c?.tokens)} / ${kfmt(c?.window)}`,
      f: ctxF,
      prev: D.prev?.ctx?.pct != null ? D.prev.ctx.pct / 100 : null,
      color: level(D, (c?.pct ?? 0) / f.ceiling),
      redline: f.ceiling < 100 ? f.ceiling / 100 : undefined,
      live: b.running,
    },
    {
      label: cfg.budgetUsd > 0 ? `Cost of $${cfg.budgetUsd}` : 'Cost',
      value: money(c?.usd),
      sub: r.perHour !== null ? `${money(r.perHour)}/h` : '–',
      f: budgetF ?? (c?.usd != null ? clamp(c.usd / 10) : null),
      prev: D.prev?.ctx?.usd != null ? (cfg.budgetUsd > 0 ? D.prev.ctx.usd / cfg.budgetUsd : clamp(D.prev.ctx.usd / 10)) : null,
      color: budgetF !== null ? level(D, budgetF) : p.steel,
      redline: cfg.budgetUsd > 0 ? 1 : undefined,
    },
    {
      label: 'Cache hit',
      value: hit !== null ? `${Math.round(hit * 100)}%` : '–',
      sub: throughput(b) !== null ? `${Math.round(throughput(b) ?? 0)} tok/s` : `${kfmt(b.tokens.cacheRead)} read`,
      f: hit,
      prev: prevHit,
      color: hit === null ? p.faint : hit > 0.7 ? p.sage : hit > 0.4 ? p.amber : p.rust,
    },
    {
      label: 'Temp',
      value: v?.tempC != null ? `${Math.round(v.tempC)}°` : '–',
      sub: v?.pct != null ? `bat ${v.pct}%${v.discharging ? ' ↓' : ''}` : '',
      f: tF,
      prev: D.prev?.vitals?.tempC != null ? D.prev.vitals.tempC / (cfg.maxTempC + 15) : null,
      color: v?.tempC != null ? level(D, v.tempC / cfg.maxTempC - 0.15) : p.faint,
      redline: cfg.maxTempC / (cfg.maxTempC + 15),
    },
  ])
  parts.push(g.body)
  y += g.h + gap

  const lim = limitsRow(D, b, y, c?.limits ?? [])
  if (lim.h) {
    parts.push(lim.body)
    y += lim.h + gap
  }

  const fl = flow(D, b, y)
  parts.push(fl.body)
  y += fl.h + gap

  // Trends: side by side when wide, stacked when narrow.
  const wide = D.W >= 600
  const tw = wide ? (D.W - gap) / 2 : D.W
  const th = 104
  parts.push(panel(D, 0, y, tw, th, 'Context trend', f.burn !== null ? `+${f.burn.toFixed(1)}% / turn` : ''))
  parts.push(spark(D, 14, y + 34, tw - 28, 56, b.ctxHist, p.steel, 100, f.ceiling))
  const ax = wide ? tw + gap : 0
  const ay = wide ? y : y + th + gap
  parts.push(panel(D, ax, ay, tw, th, 'Activity / min', `${b.activity[b.activity.length - 1] ?? 0} now`))
  parts.push(spark(D, ax + 14, ay + 34, tw - 28, 56, b.activity.slice(-30), p.amber))
  y = ay + th + gap

  // Turn timeline: bar height = time, color = cost, a breathing bar for the live turn.
  const turns = b.turns.slice(wide ? -32 : -18)
  const slots = wide ? 32 : 18
  const maxMs = Math.max(1, ...turns.map(t => t.ms), b.running ? b.now - b.turnStart : 0)
  const maxUsd = Math.max(0.0001, ...turns.map(t => t.usd ?? 0))
  const ph = 112
  parts.push(panel(D, 0, y, D.W, ph, 'Turns', r.perTurn !== null ? `${money(r.perTurn)} / turn · height = time · tint = cost` : 'height = time · tint = cost'))
  const bw = (D.W - 28) / slots
  const base = y + ph - 16
  for (let i = 0; i < slots; i++) parts.push(`<rect x="${r1(14 + i * bw)}" y="${r1(base - 62)}" width="${r1(bw - 3)}" height="62" rx="2" fill="${p.grid}" opacity="0.5"/>`)
  turns.forEach((t, i) => {
    const h = Math.max(3, (t.ms / maxMs) * 62)
    const col = t.reason !== 'answer' ? p.rust : t.usd === null ? p.steel : level(D, ((t.usd ?? 0) / maxUsd) * 0.85)
    parts.push(`<rect x="${r1(14 + i * bw)}" y="${r1(base - h)}" width="${r1(bw - 3)}" height="${r1(h)}" rx="2" fill="${col}">${tip(t)}</rect>`)
  })
  if (b.running && turns.length < slots) {
    const h = Math.max(3, Math.min(62, ((b.now - b.turnStart) / maxMs) * 62))
    parts.push(`<rect x="${r1(14 + turns.length * bw)}" y="${r1(base - h)}" width="${r1(bw - 3)}" height="${r1(h)}" rx="2" fill="${p.amber}">${breathe(D, 'opacity', 0.45, 1, 1.6)}</rect>`)
  }
  y += ph

  const ins = insights(b, cfg)
  const rows: Note[] = []
  if (ins.costly) rows.push({ t: `priciest turn ${money(ins.costly.usd)} · ${dur(ins.costly.ms)} · fed by ${ins.costly.fed?.length ? ins.costly.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : 'no tool output'}`, color: p.amber })
  for (const t of ins.tips) rows.push({ t: `› ${t}`, color: p.ink })
  if (rows.length) {
    const n = notes(D, y + gap, 'Why it costs what it does', '', rows)
    parts.push(n.body)
    y += gap + n.h
  }
  return svg(D, y, parts.join(''))
}

export const contextPage = (D: Draw, b: Board) => {
  const p = D.p
  const cp = b.comp
  const parts: string[] = []
  let y = 0
  const gap = 10
  const SLICE = [p.steel, p.sage, p.sand, p.amber, p.rose, p.rust, p.faint]

  if (!cp) {
    parts.push(panel(D, 0, 0, D.W, 70, 'Context composition'))
    parts.push(txt(D, D.W / 2, 50, 'measuring… (refreshes after each turn)', { size: 10, anchor: 'middle', color: p.faint }))
    y = 70
  } else {
    const slices = cp.slices.slice().sort((x, z) => z.tokens - x.tokens)
    const used = slices.reduce((s, x) => s + x.tokens, 0)
    const max = Math.max(cp.max, used, 1)
    const rows = slices.length
    const h = 82 + rows * 20
    parts.push(panel(D, 0, y, D.W, h, 'Context composition', `${kfmt(used)} of ${kfmt(max)}${cp.model ? ` · ${short(cp.model, 22)}` : ''}`))
    // The window as one bar: each category a segment, free space as the ground, the compaction point as a red-line.
    const bx = 14
    const bw = D.W - 28
    let x = bx
    parts.push(`<rect x="${bx}" y="${y + 34}" width="${bw}" height="16" rx="4" fill="${p.grid}"/>`)
    slices.forEach((s, i) => {
      const w = (s.tokens / max) * bw
      parts.push(`<rect x="${r1(x)}" y="${y + 34}" width="${r1(Math.max(0.5, w - 1))}" height="16" fill="${SLICE[i % SLICE.length]}"/>`)
      x += w
    })
    if (cp.autoCompact && cp.compactAt) {
      const mx = bx + clamp(cp.compactAt / max) * bw
      parts.push(`<rect x="${r1(mx - 1)}" y="${y + 29}" width="2" height="26" rx="1" fill="${p.rust}"/>`)
      parts.push(txt(D, mx, y + 66, `auto-compact ${kfmt(cp.compactAt)}`, { size: 9, anchor: mx > D.W - 90 ? 'end' : 'middle', color: p.rust, mono: true }))
    } else {
      parts.push(txt(D, D.W - 14, y + 66, cp.autoCompact ? '' : 'auto-compact off', { size: 9, anchor: 'end', color: p.faint }))
    }
    slices.forEach((s, i) => {
      const ry = y + 86 + i * 20
      const pctOf = (s.tokens / max) * 100
      parts.push(`<rect x="14" y="${ry - 8}" width="9" height="9" rx="2" fill="${SLICE[i % SLICE.length]}"/>`)
      parts.push(txt(D, 30, ry, short(s.name, D.W >= 600 ? 40 : 24), { size: 10.5, color: p.ink }))
      parts.push(meter(D, D.W >= 600 ? 330 : 200, ry - 6, D.W >= 600 ? 170 : 90, s.tokens / max, null, SLICE[i % SLICE.length] ?? p.steel, 4))
      parts.push(txt(D, D.W - 60, ry, kfmt(s.tokens), { size: 10, mono: true, anchor: 'end', color: p.ink }))
      parts.push(txt(D, D.W - 14, ry, `${pctOf.toFixed(1)}%`, { size: 10, mono: true, anchor: 'end' }))
    })
    y += h + gap
  }

  // Tokens: where the input came from (fresh, cache read, cache write) and what came out.
  const t = b.tokens
  const totalIn = t.input + t.cacheRead + t.cacheWrite
  const hit = cacheHit(t)
  const tp = throughput(b)
  const th = 118
  parts.push(panel(D, 0, y, D.W, th, 'Tokens this session', hit !== null ? `${Math.round(hit * 100)}% served from cache` : ''))
  const segs = [
    { name: 'cache read', n: t.cacheRead, c: p.sage },
    { name: 'cache write', n: t.cacheWrite, c: p.sand },
    { name: 'fresh input', n: t.input, c: p.steel },
  ]
  let sx = 14
  const sw = D.W - 28
  parts.push(`<rect x="14" y="${y + 34}" width="${sw}" height="10" rx="3" fill="${p.grid}"/>`)
  for (const s of segs) {
    const w = totalIn ? (s.n / totalIn) * sw : 0
    if (w > 0) parts.push(`<rect x="${r1(sx)}" y="${y + 34}" width="${r1(Math.max(0.5, w - 1))}" height="10" fill="${s.c}"/>`)
    sx += w
  }
  const stats = [
    { k: 'Cache read', v: kfmt(t.cacheRead), c: p.sage },
    { k: 'Cache write', v: kfmt(t.cacheWrite), c: p.sand },
    { k: 'Fresh input', v: kfmt(t.input), c: p.steel },
    { k: 'Output', v: kfmt(t.output), c: p.amber },
    { k: 'Speed', v: tp !== null ? `${Math.round(tp)}/s` : '–', c: p.ink },
  ]
  const per = D.W >= 600 ? 5 : 3
  const cw = (D.W - 28) / per
  stats.forEach((s, i) => {
    const cx = 14 + (i % per) * cw
    const cy = y + 70 + Math.floor(i / per) * 34
    parts.push(label(D, cx, cy, s.k))
    parts.push(txt(D, cx, cy + 18, s.v, { size: 15, weight: 600, mono: true, color: s.c }))
  })
  y += (D.W >= 600 ? th : th + 34) + gap

  // What tool results put back into the window, estimated from the text the model reads.
  const weight = ctxWeight(b).slice(0, 6)
  if (weight.length) {
    const top = weight[0]?.out ?? 1
    const wh = 40 + weight.length * 20
    const mx = D.W >= 600 ? 150 : 110
    parts.push(panel(D, 0, y, D.W, wh, 'Fed back by tools', `est. ${kfmt(weight.reduce((s, w) => s + w.out, 0))} tokens`))
    weight.forEach((w, i) => {
      const ry = y + 44 + i * 20
      parts.push(txt(D, 14, ry, short(w.tool, D.W >= 600 ? 18 : 12), { size: 10.5, weight: 600, color: p.ink }))
      parts.push(meter(D, mx, ry - 6, D.W - mx - 120, w.out / top, null, i === 0 ? p.amber : p.steel, 4))
      parts.push(txt(D, D.W - 60, ry, kfmt(w.out), { size: 10, mono: true, anchor: 'end', color: p.ink }))
      parts.push(txt(D, D.W - 14, ry, `${Math.round(w.share * 100)}%`, { size: 10, mono: true, anchor: 'end' }))
    })
    y += wh + gap
  }

  // The files whose reads and edits fed the window most.
  const heavy = fileWeight(b).slice(0, 5)
  if (heavy.length) {
    const hh = 40 + heavy.length * 20
    parts.push(panel(D, 0, y, D.W, hh, 'Heaviest files', 'est. tokens fed · reads'))
    heavy.forEach((f, i) => {
      const ry = y + 44 + i * 20
      parts.push(txt(D, 14, ry, shortPath(f.path, D.W >= 600 ? 60 : 34), { size: 10, mono: true, color: p.ink }))
      parts.push(txt(D, D.W - 60, ry, kfmt(f.out), { size: 10, mono: true, anchor: 'end', color: i === 0 ? p.amber : p.ink }))
      parts.push(txt(D, D.W - 14, ry, `${f.read}×`, { size: 10, mono: true, anchor: 'end' }))
    })
    y += hh + gap
  }

  // Memory files and MCP tools: the always-loaded weight in the window.
  if (cp && (cp.memory.length || cp.mcp.length)) {
    const mem = cp.memory.slice(0, 6)
    const mcp = cp.mcp.filter(m => m.loaded).slice(0, 6)
    const rows = mem.length + mcp.length + (mem.length ? 1 : 0) + (mcp.length ? 1 : 0)
    const h = 36 + rows * 19
    parts.push(panel(D, 0, y, D.W, h, 'Always loaded', 'tokens'))
    let ry = y + 40
    const section = (title: string) => {
      parts.push(label(D, 14, ry, title))
      ry += 19
    }
    const row = (name: string, n: number) => {
      parts.push(txt(D, 24, ry, name, { size: 10, color: p.ink, mono: true }))
      parts.push(txt(D, D.W - 14, ry, kfmt(n), { size: 10, mono: true, anchor: 'end' }))
      ry += 19
    }
    if (mem.length) {
      section('Memory files')
      mem.forEach(m => row(shortPath(m.path, D.W >= 600 ? 64 : 38), m.tokens))
    }
    if (mcp.length) {
      section('MCP tools')
      mcp.forEach(m => row(short(`${m.server} · ${m.name}`, D.W >= 600 ? 64 : 38), m.tokens))
    }
    y += h
  } else {
    y -= gap
  }
  return svg(D, y, parts.join(''))
}

export const tools = (D: Draw, b: Board) => {
  const p = D.p
  const rows = toolBoard(b).slice(0, 14)
  const wide = D.W >= 600
  const top = Math.max(1, ...rows.map(r => r.n))
  const rh = 26
  const h = 44 + Math.max(1, rows.length) * rh
  const barX = wide ? 128 : 100
  const barW = wide ? 200 : 130
  const parts: string[] = [panel(D, 0, 0, D.W, h, 'Tool leaderboard', wide ? 'calls · ctx fed · success · avg · p95' : 'calls · ok · p95')]
  if (!rows.length) parts.push(txt(D, D.W / 2, 50, 'no tool calls yet', { size: 10, anchor: 'middle', color: p.faint }))
  const prev = D.prev?.stats ?? {}
  rows.forEach((r, i) => {
    const y = 36 + i * rh
    const w = (r.n / top) * barW
    const was = prev[r.tool]?.n
    parts.push(txt(D, 14, y + 10, short(r.tool, wide ? 16 : 12), { size: 10.5, weight: 600, color: p.ink }))
    parts.push(`<rect x="${barX}" y="${y + 3}" width="${barW}" height="8" rx="4" fill="${p.grid}"/>`)
    // The whole bar is the failures' color; the successful share is drawn over it, so the split always shows.
    parts.push(
      `<rect x="${barX}" y="${y + 3}" width="${r1(Math.max(3, w))}" height="8" rx="4" fill="${r.okPct < 100 ? p.rust : p.sage}">${ease(D, 'width', was !== undefined ? Math.max(3, (was / top) * barW) : null, Math.max(3, w))}</rect>`,
    )
    if (r.okPct < 100 && r.okPct > 0) parts.push(`<rect x="${barX}" y="${y + 3}" width="${r1(Math.max(3, w * (r.okPct / 100)))}" height="8" rx="4" fill="${p.sage}"/>`)
    parts.push(txt(D, barX + barW + 10, y + 10, String(r.n), { size: 10, mono: true, color: p.ink }))
    if (wide) {
      parts.push(txt(D, 400, y + 10, r.out ? kfmt(r.out) : '–', { size: 10, mono: true, anchor: 'end', color: p.steel }))
      parts.push(txt(D, 470, y + 10, `${r.okPct}%`, { size: 10, mono: true, anchor: 'end', color: r.okPct < 90 ? p.rust : p.sub }))
      parts.push(txt(D, 548, y + 10, dur(r.avg), { size: 10, mono: true, anchor: 'end' }))
    }
    parts.push(txt(D, D.W - 14, y + 10, dur(r.p95), { size: 10, mono: true, anchor: 'end', color: r.p95 > 30000 ? p.amber : p.sub }))
  })
  const st = streaks(b)
  if (!st.length) return svg(D, h, parts.join(''))
  const n = notes(D, h + 10, 'Failing in a row', '', st.slice(0, 4).map(s => ({ t: `${s.tool} · ${s.detail}`, right: `${s.n}×`, color: p.rust })))
  parts.push(n.body)
  return svg(D, h + 10 + n.h, parts.join(''))
}

export const files = (D: Draw, b: Board) => {
  const p = D.p
  const rows = fileBoard(b).slice(0, 24)
  const cols = D.W >= 600 ? 3 : 2
  const gap = 8
  const tw = (D.W - 28 - (cols - 1) * gap) / cols
  const lines = Math.max(1, Math.ceil(rows.length / cols))
  const top = Math.max(1, ...rows.map(r => r.edit + r.write))
  const h = 44 + lines * 50
  const parts: string[] = [panel(D, 0, 0, D.W, h, 'File heatmap', `${rows.length} files · tint = changes`)]
  if (!rows.length) parts.push(txt(D, D.W / 2, 56, 'no files touched yet', { size: 10, anchor: 'middle', color: p.faint }))
  rows.forEach((r, i) => {
    const x = 14 + (i % cols) * (tw + gap)
    const y = 34 + Math.floor(i / cols) * 50
    const changed = r.edit + r.write
    const heat = changed / top
    const col = changed === 0 ? p.steel : heat > 0.66 ? p.rust : heat > 0.33 ? p.amber : p.sage
    parts.push(`<rect x="${r1(x + 0.5)}" y="${y + 0.5}" width="${r1(tw - 1)}" height="43" rx="7" fill="${col}" fill-opacity="${changed ? 0.1 + 0.22 * heat : 0.05}" stroke="${col}" stroke-opacity="0.45"/>`)
    parts.push(`<rect x="${r1(x + 0.5)}" y="${y + 9}" width="3" height="26" rx="1.5" fill="${col}"/>`)
    parts.push(txt(D, x + 12, y + 18, shortPath(r.path, cols === 3 ? 27 : 26), { size: 10, weight: 600, color: p.ink, mono: true }))
    parts.push(txt(D, x + 12, y + 34, `${r.edit}e · ${r.write}w · ${r.read}r${r.out ? ` · ${kfmt(r.out)} fed` : ''}`, { size: 9.5, mono: true }))
  })
  const rr = rereads(b)
  if (!rr.rows.length) return svg(D, h, parts.join(''))
  const n = notes(D, h + 10, 'Read again', `~${kfmt(rr.waste)} tokens repeated`, rr.rows.slice(0, 5).map(f => ({ t: shortPath(f.path, D.W >= 600 ? 70 : 42), right: `${f.read}× · ${kfmt(f.waste)}`, color: p.ink })))
  parts.push(n.body)
  return svg(D, h + 10 + n.h, parts.join(''))
}

export const agents = (D: Draw, b: Board) => {
  const p = D.p
  const list = b.agents.slice(-12)
  const t0 = list.length ? Math.min(...list.map(a => a.startedAt)) : b.now
  const span = Math.max(1000, b.now - t0)
  const lane = 32
  const wide = D.W >= 600
  const x0 = wide ? 176 : 120
  const lw = D.W - x0 - (wide ? 120 : 64)
  const h = 50 + Math.max(1, list.length) * lane
  const parts: string[] = [panel(D, 0, 0, D.W, h, 'Subagent swimlanes', list.length ? `window ${dur(span)}` : '')]
  if (!list.length) parts.push(txt(D, D.W / 2, 56, 'no subagents yet', { size: 10, anchor: 'middle', color: p.faint }))
  // Time grid: quarter marks across the window.
  for (let i = 0; i <= 4; i++) {
    const gx = x0 + (lw * i) / 4
    parts.push(`<line x1="${r1(gx)}" x2="${r1(gx)}" y1="30" y2="${h - 12}" stroke="${p.grid}"/>`)
  }
  list.forEach((a, i) => {
    const y = 38 + i * lane
    const col = a.status === 'run' ? p.amber : a.status === 'done' ? p.sage : a.status === 'stopped' ? p.faint : p.rust
    const sx = x0 + ((a.startedAt - t0) / span) * lw
    const ex = x0 + (((a.endedAt ?? b.now) - t0) / span) * lw
    const bw = Math.max(5, ex - sx)
    parts.push(dot(D, 20, y + 8, col, a.status === 'run', 3.5))
    parts.push(txt(D, 32, y + 6, short(a.type, wide ? 20 : 13), { size: 10.5, weight: 600, color: p.ink }))
    parts.push(txt(D, 32, y + 19, short(a.model || a.status, wide ? 22 : 14), { size: 9, mono: true, color: p.faint }))
    parts.push(`<rect x="${r1(sx)}" y="${y + 2}" width="${r1(bw)}" height="12" rx="3" fill="${col}" opacity="${a.status === 'run' ? 1 : 0.8}">${a.status === 'run' ? breathe(D, 'opacity', 0.6, 1, 1.6) : ''}</rect>`)
    parts.push(txt(D, D.W - 14, y + 12, `${a.tools}t${a.tokens ? ` · ${kfmt(a.tokens)}` : ''} · ${dur((a.endedAt ?? b.now) - a.startedAt)}`, { size: 9.5, mono: true, anchor: 'end' }))
  })
  return svg(D, h, parts.join(''))
}

export const spend = (D: Draw, b: Board, cfg: Cfg, life: Lifetime | null) => {
  const p = D.p
  const wide = D.W >= 600
  const parts: string[] = []
  let y = 0
  const gap = 10
  const r = costRate(b)
  const left = budgetRunway(b, cfg)

  // Cost waterfall: each turn's cost stacked on the running total, the budget as a red line.
  const slots = wide ? 32 : 18
  const turns = b.turns.filter(t => t.usd !== null).slice(-slots)
  const spent = turns.reduce((s, t) => s + (t.usd ?? 0), 0)
  const end = Math.max(b.ctx?.usd ?? 0, spent)
  const start = end - spent
  // The scale runs from what was spent before the window to the total, so each turn's step stays readable;
  // the budget joins the scale only when it is close enough not to flatten the steps.
  const budgetShown = cfg.budgetUsd > 0 && cfg.budgetUsd - start <= (end - start) * 1.6
  const top = start + Math.max(end - start, budgetShown ? cfg.budgetUsd - start : 0, 0.0001) * 1.08
  const ch = 92
  const wh = ch + 58
  const base = y + 34 + ch
  const yOf = (usd: number) => base - ((usd - start) / (top - start)) * ch
  parts.push(panel(D, 0, y, D.W, wh, 'Cost waterfall', left !== null ? `~${left} turns of budget left` : r.perTurn !== null ? `${money(r.perTurn)} / turn` : ''))
  if (!turns.length) {
    parts.push(txt(D, D.W / 2, y + 34 + ch / 2, 'no costed turns yet', { size: 10, anchor: 'middle', color: p.faint }))
  } else {
    const x0 = 14
    const bw = (D.W - 28) / Math.max(turns.length, wide ? 16 : 10)
    for (let i = 1; i < 4; i++) parts.push(`<line x1="${x0}" x2="${D.W - 14}" y1="${r1(base - (ch * i) / 4)}" y2="${r1(base - (ch * i) / 4)}" stroke="${p.grid}"/>`)
    parts.push(`<line x1="${x0}" x2="${D.W - 14}" y1="${base}" y2="${base}" stroke="${p.line}"/>`)
    if (start > 0) parts.push(txt(D, x0, base + 18, `from ${money(start)}`, { size: 9.5, mono: true, color: p.faint }))
    const maxUsd = Math.max(0.0001, ...turns.map(t => t.usd ?? 0))
    let cum = start
    turns.forEach((t, i) => {
      const usd = t.usd ?? 0
      const x = x0 + i * bw
      const yTop = yOf(cum + usd)
      // Rust is kept for turns that ended badly; cost alone tops out at amber.
      const col = t.reason !== 'answer' ? p.rust : level(D, (usd / maxUsd) * 0.75)
      parts.push(`<rect x="${r1(x)}" y="${r1(yTop)}" width="${r1(Math.max(1, bw - 3))}" height="${r1(Math.max(1.5, yOf(cum) - yTop))}" rx="1.5" fill="${col}">${tip(t)}</rect>`)
      if (i < turns.length - 1) parts.push(`<line x1="${r1(x + bw - 3)}" x2="${r1(x + bw)}" y1="${r1(yTop)}" y2="${r1(yTop)}" stroke="${p.faint}" stroke-width="0.8"/>`)
      cum += usd
    })
    if (budgetShown) {
      const by = yOf(cfg.budgetUsd)
      parts.push(`<line x1="${x0}" x2="${D.W - 14}" y1="${r1(by)}" y2="${r1(by)}" stroke="${p.rust}" stroke-dasharray="3 4" opacity="0.85"/>`)
      parts.push(txt(D, D.W - 14, by - 4, `budget ${money(cfg.budgetUsd)}`, { size: 9, mono: true, anchor: 'end', color: p.rust }))
    }
    parts.push(txt(D, D.W / 2, base + 18, `${turns.length} turns · +${money(spent)}`, { size: 9.5, mono: true, anchor: 'middle' }))
    parts.push(txt(D, D.W - 14, base + 18, `total ${money(end)}${cfg.budgetUsd > 0 && !budgetShown ? ` of ${money(cfg.budgetUsd)}` : ''}`, { size: 9.5, mono: true, anchor: 'end', color: p.ink }))
  }
  y += wh + gap

  // Cost and volume per model.
  const rows = modelSplit(b).slice(0, 5)
  const mh = 40 + Math.max(1, rows.length) * 22
  const mx = wide ? 220 : 130
  const mw = wide ? 190 : D.W - mx - 84
  parts.push(panel(D, 0, y, D.W, mh, 'By model', wide ? 'share of cost · turns · output · cost' : 'share · cost'))
  if (!rows.length) parts.push(txt(D, D.W / 2, y + 48, 'no finished turns yet', { size: 10, anchor: 'middle', color: p.faint }))
  rows.forEach((m, i) => {
    const ry = y + 44 + i * 22
    parts.push(txt(D, 14, ry, short(m.model, wide ? 28 : 16), { size: 10.5, weight: 600, color: p.ink, mono: true }))
    parts.push(meter(D, mx, ry - 6, mw, m.share, null, [p.amber, p.steel, p.sage, p.sand, p.rose][i] ?? p.steel, 5))
    if (wide) {
      parts.push(txt(D, 470, ry, `${m.turns}t`, { size: 10, mono: true, anchor: 'end' }))
      parts.push(txt(D, 548, ry, `${kfmt(m.output)} out`, { size: 10, mono: true, anchor: 'end' }))
    }
    parts.push(txt(D, D.W - 14, ry, money(m.usd), { size: 10, mono: true, anchor: 'end', color: p.ink }))
  })
  y += mh + gap

  // The last 30 days from the lifetime store: one cell per day, tinted by spend.
  if (life) {
    const days = lastDays(life, b.now, 30)
    const per = wide ? 30 : 15
    const lines = Math.ceil(days.length / per)
    const cw = (D.W - 28) / per
    const cellH = wide ? 26 : 22
    const dh = 34 + lines * (cellH + 4) + 40
    const top30 = Math.max(0.0001, ...days.map(d => d.usd))
    const active = days.filter(d => d.turns > 0).length
    const sum = days.reduce((s, d) => s + d.usd, 0)
    parts.push(panel(D, 0, y, D.W, dh, 'Last 30 days', `${money(sum)} · ${days.reduce((s, d) => s + d.turns, 0)} turns · ${active} active days`))
    days.forEach((d, i) => {
      const x = 14 + (i % per) * cw
      const cy = y + 34 + Math.floor(i / per) * (cellH + 4)
      const today = i === days.length - 1
      const fill = d.usd > 0 ? `fill="${p.amber}" fill-opacity="${(0.15 + 0.85 * (d.usd / top30)).toFixed(2)}"` : `fill="${d.turns ? p.steel : p.grid}"${d.turns ? ' fill-opacity="0.35"' : ''}`
      parts.push(`<rect x="${r1(x)}" y="${cy}" width="${r1(cw - 3)}" height="${cellH}" rx="3" ${fill}${today ? ` stroke="${p.amber}" stroke-width="1.2"` : ''}/>`)
    })
    const ly = y + 34 + lines * (cellH + 4) + 12
    parts.push(txt(D, 14, ly, days[0]?.key.slice(5) ?? '', { size: 9, mono: true, color: p.faint }))
    const todayUsd = days[days.length - 1]?.usd ?? 0
    const overDay = cfg.dailyBudgetUsd > 0 && todayUsd >= cfg.dailyBudgetUsd
    parts.push(
      txt(D, D.W - 14, ly, `today ${money(todayUsd)}${cfg.dailyBudgetUsd > 0 ? ` of ${money(cfg.dailyBudgetUsd)}` : ''}`, { size: 9, mono: true, anchor: 'end', color: overDay ? p.rust : p.amber }),
    )
    const wk = weekCompare(life, b.now)
    parts.push(
      txt(D, 14, ly + 18, `last 7 days ${money(wk.week)}${wk.change !== null ? ` · ${wk.change >= 0 ? '+' : ''}${Math.round(wk.change * 100)}% on the week before` : ''}`, {
        size: 9.5,
        mono: true,
        color: wk.change !== null && wk.change > 0.25 ? p.amber : p.sub,
      }),
    )
    y += dh
  } else {
    y -= gap
  }
  const priciest = b.turns.filter(t => t.usd !== null && t.usd > 0).slice(-12).sort((x, z) => (z.usd ?? 0) - (x.usd ?? 0)).slice(0, 3)
  if (priciest.length) {
    const n = notes(D, y + gap, 'Priciest turns', 'what fed them', priciest.map(t => ({ t: `${money(t.usd)} · ${dur(t.ms)} · ${t.tools} tools · ${t.fed?.length ? t.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : '–'}`, color: p.ink })))
    parts.push(n.body)
    y += gap + n.h
  }
  const recent = (life?.recent ?? []).slice(-6).reverse()
  if (recent.length) {
    const n = notes(D, y + gap, 'Recent sessions', 'grade · length · turns · cost', recent.map(s => ({ t: `${s.at === b.startedAt ? '▸ ' : ''}${dayKey(s.at).slice(5)} · ${s.grade} · ${dur(s.ms)} · ${s.turns} turns${s.branch ? ` · ${s.branch}` : ''}`, right: money(s.usd), color: s.grade === 'A' ? p.sage : s.grade === 'B' ? p.ink : s.grade === 'C' ? p.amber : p.rust })))
    parts.push(n.body)
    y += gap + n.h
  }
  return svg(D, y, parts.join(''))
}

export const system = (D: Draw, b: Board, cfg: Cfg) => {
  const p = D.p
  const v = b.vitals
  const pv = D.prev?.vitals
  const comp = compliance(b)
  const parts: string[] = []
  let y = 0
  const gap = 10
  const g = gauges(D, y, 'Machine', v?.discharging ? 'on battery' : 'on AC', [
    {
      label: 'Temp',
      value: v?.tempC != null ? `${Math.round(v.tempC)}°` : '–',
      sub: `limit ${cfg.maxTempC}°`,
      f: v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null,
      prev: pv?.tempC != null ? pv.tempC / (cfg.maxTempC + 15) : null,
      color: v?.tempC != null ? level(D, v.tempC / cfg.maxTempC - 0.15) : p.faint,
      redline: cfg.maxTempC / (cfg.maxTempC + 15),
    },
    {
      label: v?.discharging ? 'Battery ↓' : 'Battery',
      value: v?.pct != null ? `${v.pct}%` : '–',
      sub: `floor ${cfg.minBatteryPct}%`,
      f: v?.pct != null ? v.pct / 100 : null,
      prev: pv?.pct != null ? pv.pct / 100 : null,
      color: v?.pct != null ? level(D, 1 - v.pct / 100) : p.faint,
      redline: cfg.minBatteryPct / 100,
      live: Boolean(v?.discharging),
    },
    {
      label: 'Memory',
      value: v?.memPct != null ? `${v.memPct}%` : '–',
      sub: '',
      f: v?.memPct != null ? v.memPct / 100 : null,
      prev: pv?.memPct != null ? pv.memPct / 100 : null,
      color: level(D, (v?.memPct ?? 0) / 100),
    },
    {
      label: 'Load',
      value: v?.load1 != null ? v.load1.toFixed(1) : '–',
      sub: cfg.threads ? `${cfg.threads} threads` : '',
      f: v?.load1 != null ? v.load1 / (cfg.threads || 8) : null,
      prev: pv?.load1 != null ? pv.load1 / (cfg.threads || 8) : null,
      color: level(D, (v?.load1 ?? 0) / (cfg.threads || 8)),
    },
  ])
  parts.push(g.body)
  y += g.h + gap

  const peak = b.tempHist.length ? Math.round(Math.max(...b.tempHist)) : null
  parts.push(panel(D, 0, y, D.W, 112, 'Thermal trend', `${peak !== null ? `peak ${peak}° · ` : ''}red line = limit`))
  parts.push(spark(D, 14, y + 36, D.W - 28, 62, b.tempHist, p.amber, Math.max(cfg.maxTempC + 10, ...b.tempHist), cfg.maxTempC))
  y += 112 + gap

  const gh = D.W >= 600 ? 78 : 118
  parts.push(panel(D, 0, y, D.W, gh, 'Guardrails', cfg.guard ? 'heat guard armed' : 'heat guard off'))
  parts.push(label(D, 14, y + 44, cfg.prefix ? `${cfg.prefix} prefix compliance` : 'prefix compliance off'))
  const mw = D.W >= 600 ? 260 : D.W - 120
  parts.push(meter(D, 14, y + 54, mw, comp !== null ? comp / 100 : null, D.prev ? compliance(D.prev) : null, comp === null ? p.faint : comp >= 90 ? p.sage : comp >= 60 ? p.amber : p.rust, 6))
  parts.push(txt(D, 14 + mw + 10, y + 61, comp !== null ? `${comp}% of ${b.bash.total}` : '–', { size: 10, mono: true }))
  const gx = D.W >= 600 ? 400 : 14
  const gy = D.W >= 600 ? y + 44 : y + 86
  parts.push(label(D, gx, gy, 'Held by heat guard'))
  parts.push(txt(D, gx, gy + 20, `${b.guardBlocks} heavy job${b.guardBlocks === 1 ? '' : 's'}`, { size: 14, weight: 600, mono: true, color: b.guardBlocks ? p.rust : p.sage }))
  y += gh
  return svg(D, y, parts.join(''))
}

// The compact strip above the prompt: grade, state, three meters and the money line.
export const strip = (D: Draw, b: Board, cfg: Cfg) => {
  const p = D.p
  const c = b.ctx
  const v = b.vitals
  const busy = b.running || b.agents.some(a => a.status === 'run')
  const h = health(b, cfg)
  const gc = h.grade === 'A' ? p.sage : h.grade === 'B' ? p.steel : h.grade === 'C' ? p.amber : p.rust
  const ceiling = compactPct(b)
  const W = 600
  const mini = (x: number, name: string, value: string, f: number | null, pf: number | null | undefined, col: string, mark?: number) =>
    label(D, x, 13, name) + txt(D, x + 90, 13, value, { size: 9.5, mono: true, anchor: 'end', color: p.ink }) + meter(D, x, 18, 90, f, pf, col, 3, mark)
  const body =
    `<rect x="6.5" y="4.5" width="20" height="20" rx="5" fill="none" stroke="${gc}"/>` +
    txt(D, 16.5, 19, h.grade, { size: 12, weight: 700, mono: true, anchor: 'middle', color: gc }) +
    dot(D, 40, 14.5, busy ? p.amber : p.faint, busy, 3) +
    txt(D, 50, 18, b.running ? dur(b.now - b.turnStart) : busy ? 'agents' : 'idle', { size: 10, weight: 600, mono: b.running, color: busy ? p.amber : p.sub }) +
    mini(108, 'ctx', c?.pct != null ? `${Math.round(c.pct)}%` : '–', c?.pct != null ? c.pct / 100 : null, D.prev?.ctx?.pct != null ? D.prev.ctx.pct / 100 : null, level(D, (c?.pct ?? 0) / ceiling), ceiling < 100 ? ceiling / 100 : undefined) +
    mini(212, 'temp', v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, null, v?.tempC != null ? level(D, v.tempC / cfg.maxTempC - 0.15) : p.faint, cfg.maxTempC / (cfg.maxTempC + 15)) +
    mini(316, v?.discharging ? 'bat ↓' : 'bat', v?.pct != null ? `${v.pct}%` : '–', v?.pct != null ? v.pct / 100 : null, null, v?.pct != null ? level(D, 1 - v.pct / 100) : p.faint) +
    txt(D, W - 10, 18, `${money(c?.usd)} · ${b.agents.filter(a => a.status === 'run').length} agents · ${b.calls.filter(x => x.status === 'run').length} tools`, { size: 10, mono: true, anchor: 'end' })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 29" width="${W}" height="29"><rect width="${W}" height="29" rx="8" fill="${p.ground}"/>${body}</svg>`
}

// A session card to share: the grade, six numbers, what did the work, and the sun as a mark. Static, no motion.
export const card = (D: Draw, b: Board, cfg: Cfg) => {
  const p = D.p
  const W = 600
  const H = 315
  const h = health(b, cfg)
  const gc = h.grade === 'A' ? p.sage : h.grade === 'B' ? p.steel : h.grade === 'C' ? p.amber : p.rust
  const hit = cacheHit(b.tokens)
  const calls = Object.values(b.stats).reduce((s, x) => s + x.n, 0)
  const top = toolBoard(b)[0]
  const stats: [string, string][] = [
    ['Duration', dur(b.now - b.startedAt)],
    ['Turns', String(b.turnCount)],
    ['Tool calls', String(calls)],
    ['Cost', money(b.ctx?.usd)],
    ['Context', b.ctx?.pct != null ? `${Math.round(b.ctx.pct)}%` : '–'],
    ['Cache hit', hit !== null ? `${Math.round(hit * 100)}%` : '–'],
  ]
  let body =
    `<circle cx="${W - 72}" cy="78" r="44" fill="${p.amber}" opacity="0.9"/>` +
    `<circle cx="${W - 72}" cy="78" r="56" fill="none" stroke="${p.ink}" stroke-opacity="0.18"/>` +
    label(D, 32, 40, 'Embermeter · session card') +
    txt(D, 32, 58, `${dayKey(b.now)}${b.branch ? ` · ${short(b.branch, 24)}` : ''}`, { size: 10, mono: true, color: p.faint }) +
    `<rect x="32.5" y="78.5" width="62" height="62" rx="12" fill="none" stroke="${gc}" stroke-width="1.6"/>` +
    txt(D, 63.5, 121, h.grade, { size: 34, weight: 700, mono: true, anchor: 'middle', color: gc }) +
    txt(D, 112, 104, `${h.score}/100`, { size: 20, weight: 600, mono: true, color: p.ink }) +
    txt(D, 112, 124, h.reasons.length ? short(h.reasons.slice(0, 2).join(' · '), 44) : 'all clear', { size: 11, color: p.sub })
  stats.forEach(([k, v], i) => {
    const x = 32 + (i % 3) * 182
    const y = 180 + Math.floor(i / 3) * 52
    body += label(D, x, y, k) + txt(D, x, y + 24, v, { size: 20, weight: 600, mono: true, color: p.ink })
  })
  body +=
    `<line x1="32" y1="${H - 44}" x2="${W - 32}" y2="${H - 44}" stroke="${p.line}"/>` +
    txt(D, 32, H - 22, [b.model ? short(b.model, 26) : '', top ? `${top.tool} ×${top.n}` : ''].filter(Boolean).join(' · '), { size: 10, mono: true }) +
    txt(D, W - 32, H - 22, 'Keep the ember low.', { size: 11, anchor: 'end', color: p.amber })
  return svg(D, H, body, W)
}
