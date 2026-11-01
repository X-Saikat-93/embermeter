// Mounting terminal lines: one Raster per block, or plain Text when graphics are off or unavailable, and the
// frame loop that animates the blocks that move.
import type { Cfg } from '../core'
import type { Line, Tone } from './segments'
import { lineText } from './segments'
import { blocks, encode, moves } from './raster'

type Frame = { requestId: string; lines: Line[]; columns: number }

// The blocks drawn with motion, by Raster key. Rebuilt on every draw of their site, so a block that stops moving
// (the turn ended, the tab changed) drops out and the loop goes idle.
const frames = new Map<string, Frame>()
let phase = 0

const TEXT_COLOR: Partial<Record<Tone, string>> = { bad: 'error', warn: 'warning', good: 'success', sub: 'subtle', faint: 'subtle' }

// A line's Text colour: its strongest signal (bad, then warn, then good), else subtle when it is all dim.
const textColor = (l: Line): string | undefined => {
  const tones = l.segs.filter(s => s.t.trim()).map(s => (s.tone === 'heat' ? 'warn' : (s.tone ?? 'ink')))
  for (const t of ['bad', 'warn', 'good'] as const) if (tones.includes(t)) return TEXT_COLOR[t]
  return tones.length && tones.every(t => t === 'sub' || t === 'faint') ? 'subtle' : undefined
}

const asText = (els: any, lines: Line[], key: string) => {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="column">
      {lines.map((l, i) => {
        const color = textColor(l)
        return (
          <Text key={`${key}-${i}`} {...(color ? { color } : {})} {...(l.title ? { bold: true } : {})}>
            {lineText(l) || ' '}
          </Text>
        )
      })}
    </Box>
  )
}

// `site` names the drawing (one per pane tab or band) and prefixes every Raster key in it; `requestId` is what
// `$.ui.blit` addresses. A block whose cells cannot be encoded falls back to Text alone.
export const drawLines = (els: any, cfg: Cfg, requestId: string, site: string, lines: Line[], columns: number) => {
  for (const [k, f] of frames) if (f.requestId === requestId && k.startsWith(`${site}:`)) frames.delete(k)
  if (cfg.terminal === 'text' || !els.Raster) return asText(els, lines, site)
  const { Box, Raster } = els
  return (
    <Box key={site} flexDirection="column">
      {blocks(lines).map((block, i) => {
        const key = `${site}:${i}`
        try {
          const grid = encode(block, columns, cfg.theme, phase)
          if (cfg.motion === 'smooth' && moves(block)) frames.set(key, { requestId, lines: block, columns: grid.columns })
          return <Raster key={key} columns={grid.columns} rows={grid.rows} cells={grid.cells} />
        } catch {
          return asText(els, block, key)
        }
      })}
    </Box>
  )
}

// Forget every frame of a site, as when its pane closes.
export const dropFrames = (requestId: string) => {
  for (const [k, f] of frames) if (f.requestId === requestId) frames.delete(k)
}

// One animation step: repaint each moving block in place. A block the surface no longer shows answers `deny`
// and leaves the loop. Nothing moving, nothing sent.
// A function declaration: the engine follows `$` across files only into those.
export async function animate($: any, cfg: Cfg): Promise<void> {
  if (!frames.size) return
  phase = (phase + 1) % 100_000
  await Promise.all(
    [...frames].map(async ([key, f]) => {
      const grid = encode(f.lines, f.columns, cfg.theme, phase)
      const res = await $.ui.blit({ requestId: f.requestId, key, cells: grid.cells }).catch(() => ({ deny: 'failed' }))
      if (res?.deny !== undefined) frames.delete(key)
    }),
  )
}
