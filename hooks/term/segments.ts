// The terminal's drawing model: lines of coloured segments, and the primitives pages build them from.
// Pure, no `$`. raster.ts paints segments as cells; the text fallback joins them.

// Semantic colours, mapped to the theme in raster.ts. `heat` runs good → warn → bad along a meter's full width.
export type Tone = 'ink' | 'sub' | 'faint' | 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'heat'

// spin: a braille spinner (one cell); pulse: the colour breathes; flow: a highlight sweeps along the segment.
export type Anim = 'spin' | 'pulse' | 'flow'

// A run of text in one tone. For `heat`, `at` is where the run starts along its meter (0..1) and `span` the
// meter's width in cells, so each cell takes the colour of its own position.
export type Seg = { t: string; tone?: Tone; anim?: Anim; span?: number; at?: number }

// `title` starts a new block. Each block is one Raster, so a frame repaints only the blocks that move.
export type Line = { segs: Seg[]; title?: boolean }

export const clamp = (f: number) => Math.max(0, Math.min(1, f))

export const seg = (t: string, tone?: Tone, anim?: Anim): Seg => ({ t, ...(tone ? { tone } : {}), ...(anim ? { anim } : {}) })

export const line = (...segs: Seg[]): Line => ({ segs })

export const plain = (t: string, tone?: Tone): Line => line(seg(t, tone))

export const title = (t: string, note = ''): Line => ({ segs: note ? [seg(t, 'accent'), seg(`  ${note}`, 'faint')] : [seg(t, 'accent')], title: true })

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

const EIGHTHS = ' ▏▎▍▌▋▊▉'

// A meter `w` cells wide with eighth-cell precision: filled cells in `tone`, the rest a faint track.
export const meter = (f: number | null, w: number, tone: Tone = 'heat', anim?: Anim): Seg[] => {
  if (f === null || !Number.isFinite(f)) return [seg('·'.repeat(w), 'faint')]
  const units = Math.round(clamp(f) * w * 8)
  const filled = '█'.repeat(Math.floor(units / 8)) + (units % 8 ? (EIGHTHS[units % 8] ?? '') : '')
  const out: Seg[] = []
  if (filled) out.push({ ...seg(filled, tone, anim), span: w, at: 0 })
  if (w > filled.length) out.push(seg('░'.repeat(w - filled.length), 'faint'))
  return out
}

const TICKS = '▁▂▃▄▅▆▇█'

const tick = (f: number) => TICKS[Math.min(7, Math.max(0, Math.round(clamp(f) * 7)))] ?? '▁'

// The last `w` values as block heights scaled to `max` (or the largest). With `heat`, each cell is coloured by
// its own height, so a peak reads red wherever it sits.
export const spark = (values: number[], w: number, max?: number, tone: Tone = 'info'): Seg[] => {
  const vs = values.slice(-Math.max(1, w))
  if (!vs.length) return [seg('–', 'faint')]
  const top = Math.max(max ?? 0, ...vs, 1e-9)
  if (tone !== 'heat') return [seg(vs.map(v => tick(v / top)).join(''), tone)]
  return vs.map(v => ({ t: tick(v / top), tone: 'heat' as const, span: 1, at: clamp(v / top) * 0.999 }))
}

// One heat-coloured cell for a 0..1 intensity.
export const heatCell = (t: string, f: number): Seg => ({ t, tone: 'heat', span: 1, at: clamp(f) * 0.999 })
