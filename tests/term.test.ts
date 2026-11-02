import { expect, test } from 'claude-code/testing'

import { emptyBoard, parseConfig, startTurn, withCtx } from '../hooks/core'
import { termHeader, termPage, termStrip } from '../hooks/term/pages'
import { base64, blocks, DEFAULT, encode, mix, moves, safeGlyph } from '../hooks/term/raster'
import { chart, fit, leader, lineText, meter, ruled, title } from '../hooks/term/segments'

const words = (cells: string) => {
  const bin = atob(cells)
  const out: number[] = []
  for (let o = 0; o < bin.length; o += 4) out.push((bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) | (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24)) >>> 0)
  return out
}

test('base64 matches the platform encoder for every padding length', async () => {
  for (const n of [0, 1, 2, 3, 4, 5, 255]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff)
    expect(base64(bytes)).toBe(btoa(String.fromCharCode(...bytes)))
  }
})

test('cells pack glyph, foreground and background, padded to the width', async () => {
  const grid = encode([{ segs: [{ t: 'ab', tone: 'bad' }] }], 4, 'night')
  expect(grid).toMatchObject({ columns: 4, rows: 1 })
  const w = words(grid.cells)
  expect(w.length).toBe(12)
  expect(w[0]).toBe('a'.codePointAt(0))
  expect(w[1]).toBe(0xd9533f)
  expect(w[2]).toBe(DEFAULT)
  expect(w[9]).toBe(0x20)
  expect(w[10]).toBe(DEFAULT)
})

test('glyphs a Raster refuses become ?, so no input can get the tree refused', async () => {
  expect(safeGlyph('█'.codePointAt(0)!)).toBe(true)
  expect(safeGlyph('⠋'.codePointAt(0)!)).toBe(true)
  expect(safeGlyph(0x1f600)).toBe(false)
  expect(safeGlyph('漢'.codePointAt(0)!)).toBe(false)
  expect(safeGlyph(0x07)).toBe(false)
  const w = words(encode([{ segs: [{ t: '😀漢\u0007x' }] }], 4, 'washi').cells)
  expect([w[0], w[3], w[6], w[9]]).toEqual([0x3f, 0x3f, 0x3f, 'x'.codePointAt(0)])
})

test('rows are clipped to the width and capped at 256', async () => {
  const lines = Array.from({ length: 300 }, () => ({ segs: [{ t: 'x'.repeat(50) }] }))
  const grid = encode(lines, 10, 'day')
  expect(grid).toMatchObject({ columns: 10, rows: 256 })
  expect(words(grid.cells).length).toBe(10 * 256 * 3)
})

test('meters keep half-cell precision, their width and the red line', async () => {
  const text = (f: number | null, mark?: number) => meter(f, 10, 'heat', undefined, mark).map(s => s.t).join('')
  expect(text(0.5)).toBe('━━━━━─────')
  expect(text(0.55)).toBe('━━━━━╸────')
  expect(text(1.4)).toBe('━━━━━━━━━━')
  expect(text(null)).toBe('┄┄┄┄┄┄┄┄┄┄')
  expect(text(0.2, 0.8)).toBe('━━──────┊─')
  // A fill past the red line hides it: the fill's own colour already says so.
  expect(text(0.9, 0.5)).toBe('━━━━━━━━━─')
  for (const f of [0, 0.01, 0.33, 0.99]) for (const m of [undefined, 0.1, 0.5, 0.95]) expect(text(f, m).length).toBe(10)
})

test('heat colours run from good to bad along the meter', async () => {
  const w = words(encode([{ segs: meter(1, 10) }], 10, 'night').cells)
  expect(w[1]).toBe(0x7fae5f)
  expect(w[27 + 1]).toBe(0xd9533f)
  expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080)
})

test('charts stack two rows, widen short series and stand on a floor', async () => {
  const rows = (c: ReturnType<typeof chart>) => c.map(r => r.map(s => s.t).join(''))
  expect(rows(chart([0, 5, 10], 3, 2))).toEqual(['  █', '▁██'])
  expect(rows(chart([1, 2], 6, 2))).toEqual(['   ██ ', '██ ██ '])
  expect(rows(chart([50, 60], 2, 1, undefined, 'info', 40))).toEqual(['▄█'])
  expect(rows(chart([], 5, 2))).toEqual(['', '–'])
})

test('titles are ruled to the width and list rows keep their numbers', async () => {
  const t = ruled(title('Vitals', 'note'), 30)
  expect(lineText(t)).toBe(`VITALS ${'─'.repeat(17)} note `)
  expect(t.title).toBe(true)
  expect([...lineText(ruled(title('A very long section title', 'and a long note'), 20))].length).toBeGreaterThan(20)
  const row = leader(30, [{ t: '/a/very/long/path/that/never/ends.ts' }], [{ t: '12k' }])
  expect([...lineText(row)].length).toBe(30)
  expect(lineText(row).endsWith(' 12k')).toBe(true)
  expect(lineText(leader(30, [{ t: 'x' }], [{ t: '9' }]))).toBe(`  x ${'·'.repeat(24)} 9`)
})

test('a pill paints its tone as the ground with dark text', async () => {
  const w = words(encode([{ segs: [{ t: 'A', tone: 'good', pill: true }] }], 1, 'night').cells)
  expect(w[1]).not.toBe(DEFAULT)
  expect(w[2]).toBe(0x7fae5f)
})

test('pages split into blocks at titles; only a live turn moves', async () => {
  const cfg = parseConfig({ motion: 'smooth' })
  const idle = withCtx(emptyBoard(0), { tokens: 1000, window: 10000, pct: 10, usd: 0.1, limits: [] })
  const page = termPage('overview', idle, cfg, null, 80)
  expect(blocks(page).every(b => b[0] === page[0] || b[0]?.title)).toBe(true)
  expect(moves(page)).toBe(false)
  expect(moves(termHeader(idle, cfg))).toBe(false)

  const live = startTurn(idle, 1000, null)
  expect(moves(termPage('overview', live, cfg, null, 80))).toBe(true)
  expect(moves(termHeader(live, cfg))).toBe(true)
  expect(moves([termStrip(live, cfg)])).toBe(true)
  expect(moves(termHeader(live, parseConfig({ motion: 'off' })))).toBe(false)
})

test('motion changes the frame: the spinner turns and the highlight sweeps', async () => {
  const cfg = parseConfig({})
  const live = startTurn(withCtx(emptyBoard(0), { tokens: 50000, window: 100000, pct: 50, usd: 1, limits: [] }), 1000, null)
  const head = termHeader(live, cfg)
  const a = words(encode(head, 60, 'washi', 0).cells)
  const b = words(encode(head, 60, 'washi', 1).cells)
  const spinRow = 60 * 3
  expect(a[spinRow]).not.toBe(b[spinRow])
  const strip = [termStrip(live, cfg)]
  expect(encode(strip, 60, 'washi', 2).cells).not.toBe(encode(strip, 60, 'washi', 6).cells)
})

test('every page reads at the narrowest width without a line past it', async () => {
  const cfg = parseConfig({ budgetUsd: 5, commandPrefix: 'rtk' })
  const b = withCtx(emptyBoard(0), { tokens: 1000, window: 10000, pct: 10, usd: 0.1, limits: [{ kind: 'five_hour', pct: 40, resetsAt: null }] })
  for (const tab of ['overview', 'context', 'spend', 'tools', 'files', 'agents', 'system'] as const) {
    const page = termPage(tab, b, cfg, { sessions: 1, usd: 1, turns: 1, calls: 1 }, 40)
    expect(page.length).toBeGreaterThan(0)
    for (const l of page) expect([...lineText(l)].length).toBeLessThanOrEqual(40)
  }
  for (const l of termHeader({ ...b, branch: 'feature/a-very-long-branch-name', model: 'claude-opus-5-5-20261101' }, cfg, 40)) expect([...lineText(l)].length).toBeLessThanOrEqual(40)
})

test('fit clips a line with an ellipsis and keeps short ones as they are', async () => {
  const l = { segs: [{ t: 'abc' }, { t: 'defgh', tone: 'bad' as const }] }
  expect(lineText(fit(l, 20))).toBe('abcdefgh')
  expect(lineText(fit(l, 5))).toBe('abcd…')
  expect(fit(l, 5).segs[1]?.tone).toBe('bad')
})
