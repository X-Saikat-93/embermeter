// The terminal's drawing model: lines of coloured segments, and the primitives pages build them from.
// Pure, no `$`. raster.ts paints segments as cells; the text fallback joins them.

// Semantic colours, mapped to the theme in raster.ts. `heat` runs good → warn → bad along a meter's full width;
// `fade` runs from the accent down to faint, for the rules under section titles; `cool` runs info → good.
export type Tone = 'ink' | 'sub' | 'faint' | 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'heat' | 'fade' | 'cool'

// spin: a braille spinner (one cell); pulse: the colour breathes; flow: a highlight sweeps along the segment.
export type Anim = 'spin' | 'pulse' | 'flow'

// A run of text in one tone. For `heat`, `at` is where the run starts along its meter (0..1) and `span` the
// meter's width in cells, so each cell takes the colour of its own position. `pill`: the tone fills the cells'
// background and the text is drawn dark on it, as a badge.
export type Seg = { t: string; tone?: Tone; anim?: Anim; span?: number; at?: number; pill?: boolean }

// `title` starts a new block. Each block is one Raster, so a frame repaints only the blocks that move.
export type Line = { segs: Seg[]; title?: boolean }

export const clamp = (f: number) => Math.max(0, Math.min(1, f))

export const seg = (t: string, tone?: Tone, anim?: Anim): Seg => ({ t, ...(tone ? { tone } : {}), ...(anim ? { anim } : {}) })

export const line = (...segs: Seg[]): Line => ({ segs })

export const plain = (t: string, tone?: Tone): Line => line(seg(t, tone))

export const pill = (t: string, tone: Tone, anim?: Anim): Seg => ({ ...seg(t, tone, anim), pill: true })

// A section title: its label in capitals, then (once `ruled` knows the width) a rule fading to the note at the
// right. `anim` (while what the section shows is working) sweeps a highlight along the label and its rule.
export const title = (t: string, note = '', anim?: Anim): Line => ({ segs: note ? [seg(t.toUpperCase(), 'accent', anim), seg(note, 'sub')] : [seg(t.toUpperCase(), 'accent', anim)], title: true })

// A title drawn to `w`: LABEL ──────── note. Too narrow for a rule, the note follows the label and `fit` clips.
export const ruled = (l: Line, w: number): Line => {
  if (!l.title) return l
  const [label, note] = l.segs
  const lt = [...(label?.t ?? '')].length
  const nt = [...(note?.t ?? '')].length
  const room = w - lt - 2 - (nt ? nt + 1 : 0)
  if (!label || room < 3) return { ...l, segs: note ? [label ?? seg(''), seg('  '), note] : l.segs }
  const rule: Seg = { t: '─'.repeat(room), tone: 'fade', span: room, at: 0, ...(label.anim ? { anim: label.anim } : {}) }
  return { ...l, segs: [label, seg(' '), rule, seg(nt ? ' ' : ''), ...(note ? [note] : []), seg(' ')] }
}

export const gap: Line = { segs: [seg('')] }

export const lineText = (l: Line) => l.segs.map(s => s.t).join('')

// The line clipped to `w` cells, its last kept cell an ellipsis, so an overlong value is never cut silently.
export const fit = (l: Line, w: number): Line => {
  let room = w
  const segs: Seg[] = []
  const total = l.segs.reduce((n, s) => n + [...s.t].length, 0)
  if (total <= w) return l
  for (const s of l.segs) {
    const chars = [...s.t]
    if (chars.length < room) {
      segs.push(s)
      room -= chars.length
      continue
    }
    segs.push({ ...s, t: `${chars.slice(0, Math.max(0, room - 1)).join('')}…` })
    break
  }
  return { ...l, segs }
}

export const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

export const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

// Good, warn or bad for a fill level; faint when unknown.
export const level = (f: number | null): Tone => (f === null ? 'faint' : f >= 0.85 ? 'bad' : f >= 0.65 ? 'warn' : 'good')

// A thin meter `w` cells wide with half-cell precision: a heavy rule in `tone` for the fill, a faint light rule
// for the rest. `mark` (0..1) puts a red line, such as the compaction point or a limit, on the unfilled track.
export const meter = (f: number | null, w: number, tone: Tone = 'heat', anim?: Anim, mark?: number): Seg[] => {
  if (f === null || !Number.isFinite(f)) return [seg('┄'.repeat(w), 'faint')]
  const halves = Math.round(clamp(f) * w * 2)
  const filled = '━'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '╸' : '')
  const out: Seg[] = []
  if (filled) out.push({ ...seg(filled, tone, anim), span: w, at: 0 })
  const rest = w - filled.length
  if (rest <= 0) return out
  const m = mark !== undefined && mark > 0 && mark < 1 ? Math.min(w - 1, Math.round(mark * w)) - filled.length : -1
  if (m < 0) out.push(seg('─'.repeat(rest), 'faint'))
  else out.push(seg('─'.repeat(m), 'faint'), seg('┊', 'bad'), seg('─'.repeat(rest - m - 1), 'faint'))
  return out
}

const TICKS = '▁▂▃▄▅▆▇█'

// A bar chart `h` rows tall of the last `w` values, top row first: each bar with eighth-row precision, scaled to
// `max` (or the largest), on a faint baseline. With `heat` each bar is coloured by its height. A short series gets
// wider bars (up to two cells, then a gap), so it fills the chart rather than huddling at its left. `floor` is the
// value the baseline stands for, so a series that never nears zero (a temperature) still shows its swings.
export const chart = (values: number[], w: number, h = 2, max?: number, tone: Tone = 'info', floor = 0): Seg[][] => {
  const raw = values.slice(-Math.max(1, w))
  if (!raw.length) return [...Array.from({ length: h - 1 }, () => [seg('')]), [seg('–', 'faint')]]
  const vs = raw.map(v => Math.max(0, v - floor))
  const top = Math.max((max ?? 0) - floor, ...vs, 1e-9)
  const k = Math.max(1, Math.min(3, Math.floor(w / vs.length)))
  const bar = k === 1 ? 1 : k - 1
  const rows: Seg[][] = []
  for (let r = h - 1; r >= 0; r--) {
    rows.push(
      vs.flatMap(v => {
        const units = Math.round(clamp(v / top) * h * 8) - r * 8
        const base = r === 0 ? seg('▁', 'faint') : seg(' ')
        const ch = TICKS[Math.min(8, units) - 1] ?? '█'
        const cell = units <= 0 ? base : tone === 'heat' ? { t: ch, tone: 'heat' as const, span: 1, at: clamp(v / top) * 0.999 } : seg(ch, tone)
        return [...Array.from({ length: bar }, () => ({ ...cell })), ...(k > 1 ? [seg(' ')] : [])]
      }),
    )
  }
  return rows
}

// A list row: the left part, a faint dotted leader, then the right part flush with the edge. The left part is
// clipped first, so the numbers on the right always show.
export const leader = (w: number, left: Seg[], right: Seg[], indent = 2): Line => {
  const rw = right.reduce((n, s) => n + [...s.t].length, 0)
  const room = Math.max(1, w - indent - rw - 3)
  const kept = fit(line(...left), room).segs
  const lw = kept.reduce((n, s) => n + [...s.t].length, 0)
  const dots = w - indent - lw - rw - 2
  return line(seg(' '.repeat(indent)), ...kept, seg(dots > 0 ? ` ${'·'.repeat(dots)} ` : ' ', 'faint'), ...right)
}

// One heat-coloured cell for a 0..1 intensity.
export const heatCell = (t: string, f: number): Seg => ({ t, tone: 'heat', span: 1, at: clamp(f) * 0.999 })
