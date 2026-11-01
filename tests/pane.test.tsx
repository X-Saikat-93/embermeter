import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'embermeter',
  component: 'Pane',
  requestId: 'embermeter',
  props: {
    title: 'Embermeter',
    isFocused: false,
    bodyColumns: 66,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const engine = (on: any, usd: () => number = () => 0.5) => {
  on('command.register', () => ({ value: { command: 'embermeter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [], cost: { usd: usd() } } }))
  on('fs.read', () => ({ value: '50000' }))
  on('store.get', () => ({ value: null }))
  on('store.set', () => ({ value: undefined }))
}

test('the pane draws its tabs and records a tool call, on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rtk git status' })

  for (const surface of ['vscode', 'desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'tab-overview' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'copy' })).toBeTruthy()
    await ui.unmount()
  }
})

test('the tools tab lists the call', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rtk git status' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-tools' })
  const row = await ui.find({ type: 'Text', text: /Bash rtk git status/ })
  expect(row).toBeTruthy()
  await ui.unmount()
})

test('the spend tab opens on every surface', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  for (const surface of ['vscode', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-spend' })
    expect((await ui.find({ key: 'tab-spend' }))?.text).toBe('▸ Spend')
    await ui.unmount()
  }
})

// The text a terminal Raster paints, row by row: each cell is three little-endian u32s, the first its code point.
const rasterText = (props: Record<string, unknown>): string[] => {
  const bin = atob(String(props.cells))
  const cols = Number(props.columns)
  const rows: string[] = []
  for (let o = 0, x = 0, row = ''; o < bin.length; o += 12) {
    row += String.fromCodePoint(bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) | (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24))
    if (++x === cols) {
      rows.push(row.trimEnd())
      row = ''
      x = 0
    }
  }
  return rows
}

const painted = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Raster' })).flatMap((r: any) => rasterText(r.props))

test('the terminal paints each tab as coloured cells', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rtk git status' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await painted(ui)).some(r => /^Context\s+[█▏▎▍▌▋▊▉]+░+\s+20%/.test(r))).toBe(true)
  expect((await painted(ui)).some(r => /Embermeter/.test(r))).toBe(true)
  await ui.press({ key: 'tab-tools' })
  expect((await painted(ui)).some(r => /^Tool leaderboard/.test(r))).toBe(true)
  expect((await painted(ui)).some(r => /Bash\s+█/.test(r))).toBe(true)
  await ui.press({ key: 'tab-system' })
  expect((await painted(ui)).some(r => /^Memory/.test(r))).toBe(true)
  // Every tab draws something, and no Raster is wider than the body.
  for (const t of ['overview', 'context', 'spend', 'tools', 'files', 'agents', 'system']) {
    await ui.press({ key: `tab-${t}` })
    const rasters = await ui.findAll({ type: 'Raster' })
    expect(rasters.length).toBeGreaterThan(1)
    for (const r of rasters) expect(Number(r.props.columns)).toBeLessThanOrEqual(PANE.props.bodyColumns)
  }
  await ui.unmount()
})

test('the band above the prompt paints as cells in the terminal', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'embermeter', component: 'AbovePrompt', surface: 'terminal', props: {} } as any)
  expect((await painted(ui)).some(r => /ctx [█▏▎▍▌▋▊▉]+░+ 20%/.test(r))).toBe(true)
  await ui.unmount()
})

test('with terminal drawing set to text, the terminal gets plain lines', { options: { terminalDrawing: 'text' } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Context\s+[█▏▎▍▌▋▊▉]+░+\s+20%/ })).toBeTruthy()
  await ui.unmount()
})

test('the loop breaker refuses a third identical call and records it', { options: { loopBreak: true } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.tool.call({ tool: 'Bash', command: 'npm run lint' })).deny).toBe(undefined)
  expect((await $.tool.call({ tool: 'Bash', command: 'npm run lint' })).deny).toBe(undefined)
  expect((await $.tool.call({ tool: 'Bash', command: 'npm run lint' })).deny).toMatch(/loop breaker/)
  expect((await $.tool.call({ tool: 'Bash', command: 'npm run lint -- --fix' })).deny).toBe(undefined)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props } })
  await ui.press({ key: 'tab-log' })
  expect(await ui.find({ type: 'Text', text: /guard: held · Bash · loop breaker/ })).toBeTruthy()
  await ui.unmount()
})

test('the loop breaker stays out of the way unless turned on', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 4; i++) expect((await $.tool.call({ tool: 'Bash', command: 'npm run lint' })).deny).toBe(undefined)
})

test('the turn-cost stop holds tools once a turn passes its limit', { options: { turnBudgetUsd: 0.25 } }, async ($, on) => {
  let usd = 0.5
  engine(on, () => usd)
  on('turn.start', () => ({ turnId: 't1' }))
  on('session.measure', () => ({ changed: ['cost'] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBe(undefined)
  usd = 0.9
  await $.session.measure({ context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [], changed: ['cost'] } as any)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toMatch(/turn-cost stop/)
  // A subagent spends the same turn's money, so its calls are held too.
  expect((await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'sub-1' } as any)).deny).toMatch(/turn-cost stop/)
})

test('/embermeter csv and export copy the session', async ($, on) => {
  const copied: string[] = []
  engine(on)
  on('ui.copy', (_: unknown, e: any) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as any
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'embermeter', args: 'csv' } as any)).text).toMatch(/CSV/)
  expect(copied[0]?.startsWith('at,ms,usd,')).toBe(true)
  expect((await $.command.run({ command: 'embermeter', args: 'export' } as any)).text).toMatch(/JSON/)
  expect(JSON.parse(copied[1] ?? '{}').health.grade).toBe('A')
})
