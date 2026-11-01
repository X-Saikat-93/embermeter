// Segments → terminal cells for the `Raster` element: theme colours, glyph safety, motion and the packed encoding.
// Pure, no `$`.
import type { Theme } from '../core'
import type { Line, Seg, Tone } from './segments'
import { clamp } from './segments'

// The terminal's own foreground or background (bit 24 alone), so text follows the person's terminal theme.
export const DEFAULT = 0x01000000

type Ramp = Record<Exclude<Tone, 'heat' | 'ink'>, number>

// Mid tones that read on dark and light terminals alike; `ink` is always the terminal's own foreground.
// One signal colour per theme (accent), as on the SVG pages.
const RAMPS: Record<Theme, Ramp> = {
  night: { sub: 0x9a9184, faint: 0x6b655c, accent: 0xe2a23c, good: 0x7fae5f, warn: 0xe0a030, bad: 0xd9533f, info: 0x6a9fc4 },
  day: { sub: 0x8a8174, faint: 0x9d958a, accent: 0xb86a12, good: 0x5f8f45, warn: 0xc98a1c, bad: 0xc4432f, info: 0x4f7fa6 },
  washi: { sub: 0x8f877b, faint: 0x8a8173, accent: 0xd9472f, good: 0x6f8f55, warn: 0xd08a2a, bad: 0xb8322a, info: 0x55799a },
  contrast: { sub: 0xc8c8c8, faint: 0x8c8c8c, accent: 0xffd400, good: 0x00e676, warn: 0xffb300, bad: 0xff3b30, info: 0x40c4ff },
}

const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff] as const

export const mix = (a: number, b: number, k: number) => {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const f = clamp(k)
  return (Math.round(ar + (br - ar) * f) << 16) | (Math.round(ag + (bg - ag) * f) << 8) | Math.round(ab + (bb - ab) * f)
}

// good → warn → bad along 0..1.
const heat = (r: Ramp, f: number) => (f < 0.5 ? mix(r.good, r.warn, f * 2) : mix(r.warn, r.bad, (f - 0.5) * 2))

const toneColor = (r: Ramp, tone: Tone | undefined, f: number): number => {
  if (!tone || tone === 'ink') return DEFAULT
  if (tone === 'heat') return heat(r, f)
  return r[tone]
}

// A code point the Raster accepts: printable and one cell wide. Everything else draws as '?', so text from tool
// input, paths or model names can never get a tree refused.
export const safeGlyph = (cp: number) =>
  (cp >= 0x20 && cp <= 0x7e) ||
  (cp >= 0xa0 && cp <= 0x24f) ||
  (cp >= 0x2010 && cp <= 0x205e) ||
  (cp >= 0x2190 && cp <= 0x22ff) ||
  (cp >= 0x2500 && cp <= 0x25ff) ||
  (cp >= 0x2800 && cp <= 0x28ff)

const SPIN = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
const QMARK = 0x3f
const WHITE = 0xffffff

// One cell of a segment at frame `phase`: the glyph and its foreground.
const cell = (r: Ramp, s: Seg, cp: number, i: number, n: number, phase: number): [number, number] => {
  // A meter's first cell is its start colour and its last the end, whatever the width.
  const f = s.tone === 'heat' ? clamp((s.at ?? 0) + (s.span && s.span > 1 ? i / (s.span - 1) : 0)) : 0
  let fg = toneColor(r, s.tone, f)
  if (s.anim === 'spin') return [SPIN[phase % SPIN.length]?.codePointAt(0) ?? cp, fg === DEFAULT ? r.accent : fg]
  if (s.anim === 'pulse') {
    const k = (Math.sin(phase * 0.6) + 1) / 2
    fg = mix(fg === DEFAULT ? r.accent : fg, WHITE, k * 0.55)
  } else if (s.anim === 'flow') {
    // A soft highlight three cells wide sweeps left to right, then pauses off the end.
    const head = ((phase * 1.5) % (n + 10)) - 4
    const k = Math.max(0, 1 - Math.abs(i - head) / 3)
    if (k > 0) fg = mix(fg === DEFAULT ? r.accent : fg, WHITE, k * 0.6)
  }
  return [cp, fg]
}

export type Cells = { columns: number; rows: number; cells: string }

// The lines as a `columns` × lines grid (rows capped at 256), each row clipped or padded to the width.
export const encode = (lines: Line[], columns: number, theme: Theme, phase = 0): Cells => {
  const cols = Math.max(1, Math.min(512, Math.floor(columns)))
  const rows = Math.max(1, Math.min(256, lines.length))
  const r = RAMPS[theme] ?? RAMPS.washi
  const buf = new DataView(new ArrayBuffer(cols * rows * 12))
  for (let y = 0; y < rows; y++) {
    let x = 0
    for (const s of lines[y]?.segs ?? []) {
      const cps = [...s.t].map(ch => ch.codePointAt(0) ?? QMARK)
      for (let i = 0; i < cps.length && x < cols; i++, x++) {
        const raw = cps[i] ?? QMARK
        const [cp, fg] = cell(r, s, safeGlyph(raw) ? raw : QMARK, i, cps.length, phase)
        const o = (y * cols + x) * 12
        buf.setUint32(o, safeGlyph(cp) ? cp : QMARK, true)
        buf.setUint32(o + 4, fg, true)
        buf.setUint32(o + 8, DEFAULT, true)
      }
    }
    for (; x < cols; x++) {
      const o = (y * cols + x) * 12
      buf.setUint32(o, 0x20, true)
      buf.setUint32(o + 4, DEFAULT, true)
      buf.setUint32(o + 8, DEFAULT, true)
    }
  }
  return { columns: cols, rows, cells: base64(new Uint8Array(buf.buffer)) }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64. The module has no Node or DOM, so no Buffer or btoa to lean on.
export const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return out
}

// Pages split into blocks at each title, so a block that moves is repainted alone.
export const blocks = (lines: Line[]): Line[][] => {
  const out: Line[][] = []
  for (const l of lines) {
    const last = out[out.length - 1]
    if (l.title || !last) out.push([l])
    else last.push(l)
  }
  return out
}

export const moves = (lines: Line[]) => lines.some(l => l.segs.some(s => s.anim !== undefined))
