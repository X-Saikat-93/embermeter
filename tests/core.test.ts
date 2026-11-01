import { expect, test } from 'claude-code/testing'

import {
  addDay,
  fileWeight,
  gitDirOf,
  isQuiet,
  limitEta,
  parseHead,
  weekCompare,
  budgetRunway,
  cacheHit,
  ctxWeight,
  dayKey,
  estTokens,
  lastDays,
  loopWatch,
  modelSplit,
  compactPct,
  throughput,
  toComposition,
  compacted,
  compliance,
  countCpus,
  emptyBoard,
  endAgent,
  endTurn,
  fileBoard,
  finishCall,
  forecast,
  health,
  newAlerts,
  normalize,
  parseConfig,
  pickTemp,
  refuse,
  report,
  shortPath,
  spawnAgent,
  startCall,
  startTurn,
  toolBoard,
  withCtx,
  commandHeads,
  exportJson,
  insights,
  isHeavy,
  rereads,
  sessionStat,
  statusLine,
  steadyTemp,
  streaks,
  turnFeed,
  turnOver,
  turnsCsv,
  withSession,
  withVitals,
  wouldLoop,
} from '../hooks/core'
import type { Call, Lifetime } from '../types'

const cfg = parseConfig({})
const call = (id: string, tool: string, at = 1000): Call => ({ id, tool, detail: '', status: 'run', agent: false, at, ms: null })
const ctx = (pct: number, usd = 0) => ({ tokens: pct * 2000, window: 200000, pct, usd, limits: [] })

test('config falls back to safe defaults and rejects a bad pattern', async () => {
  const c = parseConfig({ maxTempC: 9999, heavyPattern: '(', commandPrefix: ' rtk ' })
  expect(c.maxTempC).toBe(80)
  expect(c.heavy.test('npm run build')).toBe(true)
  expect(c.prefix).toBe('rtk')
})

test('the theme defaults to washi and accepts night and day', async () => {
  expect(parseConfig({ theme: 'washi' }).theme).toBe('washi')
  expect(parseConfig({ theme: 'neon' }).theme).toBe('washi')
  expect(parseConfig({}).theme).toBe('washi')
  expect(parseConfig({ theme: 'night' }).theme).toBe('night')
})

test('a stored board from an older version is filled in', async () => {
  const b = normalize({ turnCount: 3, gate: { allow: 2 } })
  expect(b.turnCount).toBe(3)
  expect(b.gate.deny).toBe(0)
  expect(b.activity.length).toBe(1)
})

test('tool stats count outcomes, durations and files', async () => {
  let b = emptyBoard(0)
  b = startCall(b, call('a', 'Edit'), { file: '/src/x.ts' }, 'rtk')
  b = finishCall(b, 'a', 'ok', 200)
  b = startCall(b, call('b', 'Edit'), { file: '/src/x.ts' }, 'rtk')
  b = finishCall(b, 'b', 'fail', 400)
  b = startCall(b, call('c', 'Read'), { file: '/src/y.ts' }, 'rtk')
  b = finishCall(b, 'c', 'ok', 50)
  const edit = toolBoard(b).find(r => r.tool === 'Edit')
  expect(edit?.n).toBe(2)
  expect(edit?.okPct).toBe(50)
  expect(edit?.avg).toBe(300)
  expect(fileBoard(b)[0]?.path).toBe('/src/x.ts')
  expect(fileBoard(b)[0]?.edit).toBe(2)
})

test('prefix compliance scores Bash commands', async () => {
  let b = emptyBoard(0)
  b = startCall(b, call('a', 'Bash'), { command: 'rtk git status' }, 'rtk')
  b = startCall(b, call('b', 'Bash'), { command: 'git status' }, 'rtk')
  expect(compliance(b)).toBe(50)
})

test('turns record cost and context growth; the forecast reads the runway', async () => {
  let b = withCtx(emptyBoard(0), ctx(40, 1))
  b = startTurn(b, 1000, ctx(40, 1))
  b = endTurn(b, 5000, 4000, 'answer', ctx(50, 1.5))
  b = startTurn(b, 6000, ctx(50, 1.5))
  b = endTurn(b, 9000, 3000, 'answer', ctx(60, 2))
  expect(b.turns.length).toBe(2)
  expect(b.turns[0]?.usd).toBe(0.5)
  expect(b.turns[0]?.ctxDelta).toBe(10)
  const f = forecast(b)
  expect(f.burn).toBe(10)
  expect(f.turnsLeft).toBe(4)
})

test('agents move from running to done and count their tools', async () => {
  let b = spawnAgent(emptyBoard(0), { id: 'x', type: 'Explore', desc: '', model: '', status: 'run', startedAt: 0, endedAt: null, tools: 0 })
  b = startCall(b, { ...call('t', 'Grep'), agent: true }, { agentId: 'x' }, '')
  b = endAgent(b, 'x', 'answer', 5000)
  expect(b.agents[0]?.status).toBe('done')
  expect(b.agents[0]?.tools).toBe(1)
})

test('health grades drop with full context and heat', async () => {
  const calm = health(withCtx(emptyBoard(0), ctx(20)), cfg)
  expect(calm.grade).toBe('A')
  const hot = { ...withCtx(emptyBoard(0), ctx(98)), vitals: { tempC: 95, pct: 50, discharging: false, load1: 1, memPct: 40 } }
  expect(['C', 'D', 'F']).toContain(health(hot, cfg).grade)
})

test('alerts fire once per crossing', async () => {
  const b = withCtx(emptyBoard(0), ctx(90))
  const first = newAlerts(b, cfg).map(a => a.key)
  expect(first).toContain('ctx70')
  expect(first).toContain('ctx85')
  expect(newAlerts({ ...b, alerts: first }, cfg).length).toBe(0)
})

test('heat guard refuses only when hot or low on battery', async () => {
  const v = { tempC: 60, pct: 80, discharging: false, load1: 1, memPct: 30 }
  expect(refuse(v, cfg)).toBe(null)
  expect(refuse({ ...v, tempC: 91 }, cfg)).toContain('91C')
  expect(refuse({ ...v, pct: 10, discharging: true }, cfg)).toContain('battery')
  expect(refuse({ ...v, tempC: 91 }, parseConfig({ guard: false }))).toBe(null)
})

test('the heavy pattern matches commands, not paths or flags', async () => {
  for (const c of ['npm test', 'rtk npm run build', 'npm ci', 'npx vitest run', 'prisma migrate dev', 'pnpm install']) expect(cfg.heavy.test(c)).toBe(true)
  for (const c of ['sed -i s/a/b/ tests/core.test.ts', 'cat vite.config.ts', 'git commit --ci', 'ls build/', 'rtk git status']) expect(cfg.heavy.test(c)).toBe(false)
})

test('temperature prefers CPU sensors over ACPI and Wi-Fi zones', async () => {
  const zones = [
    { type: 'acpitz', milli: 89000 },
    { type: 'x86_pkg_temp', milli: 70000 },
    { type: 'TCPU', milli: 68000 },
    { type: 'iwlwifi_1', milli: 51000 },
  ]
  expect(pickTemp(zones)).toBe(70)
  expect(pickTemp([{ type: 'acpitz', milli: 55000 }, { type: 'x', milli: null }])).toBe(55)
  expect(pickTemp([])).toBe(null)
})

test('CPU count reads the online range list', async () => {
  expect(countCpus('0-15')).toBe(16)
  expect(countCpus('0,2-5\n')).toBe(5)
  expect(countCpus('')).toBe(null)
})

test('long paths keep their tail', async () => {
  expect(shortPath('/home/me/project/src/components/Button.tsx', 24).endsWith('Button.tsx')).toBe(true)
})

test('the report is markdown with the key figures', async () => {
  let b = withCtx(emptyBoard(0), ctx(30, 0.25))
  b = startCall(b, call('a', 'Bash'), { command: 'rtk ls' }, 'rtk')
  b = finishCall(b, 'a', 'ok', 100)
  const r = report(b, cfg, { sessions: 2, usd: 3, turns: 10, calls: 40 })
  expect(r).toContain('# Embermeter session report')
  expect(r).toContain('| Bash | 1 |')
  expect(r).toContain('All time: 2 sessions')
})

test('turn usage adds up tokens, cache hit and throughput', async () => {
  let b = startTurn(emptyBoard(0), 0, null)
  b = endTurn(b, 10_000, 10_000, 'answer', null, { input_tokens: 100, output_tokens: 500, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, model: 'claude-x' })
  expect(b.tokens.output).toBe(500)
  expect(b.model).toBe('claude-x')
  expect(cacheHit(b.tokens)).toBe(0.8)
  expect(throughput(b)).toBe(50)
})

test('the context breakdown becomes a composition, and the runway ends at auto-compact', async () => {
  const comp = toComposition(
    {
      model: 'claude-x',
      totalTokens: 60000,
      maxTokens: 200000,
      autoCompactThreshold: 160000,
      isAutoCompactEnabled: true,
      categories: [
        { name: 'System prompt', tokens: 3000, isDeferred: false, kind: 'system' },
        { name: 'Messages', tokens: 57000, isDeferred: false, kind: 'messages' },
        { name: 'Deferred', tokens: 9000, isDeferred: true, kind: 'tools' },
      ],
      memoryFiles: [{ path: '/a/CLAUDE.md', tokens: 900 }],
      mcpTools: [],
    },
    5,
  )
  expect(comp?.slices.length).toBe(2)
  expect(comp?.memory[0]?.tokens).toBe(900)
  let b = { ...withCtx(emptyBoard(0), ctx(50)), comp }
  expect(compactPct(b)).toBe(80)
  b = startTurn(b, 0, ctx(50))
  b = endTurn(b, 1000, 1000, 'answer', ctx(60))
  expect(forecast(b).turnsLeft).toBe(2)
  expect(toComposition(null, 0)).toBe(null)
})

const ran = (b: ReturnType<typeof emptyBoard>, id: string, tool: string, detail: string, status: 'ok' | 'fail' = 'ok') =>
  finishCall(startCall(b, { ...call(id, tool), detail }, {}, ''), id, status, 10)

test('the loop watch flags repeats and repeated failures, but not paging through a file', async () => {
  let b = emptyBoard(0)
  for (const id of ['a', 'b', 'c']) b = ran(b, id, 'Bash', 'npm test')
  expect(loopWatch(b)).toEqual({ tool: 'Bash', detail: 'npm test', n: 3, failing: false })
  expect(health(b, cfg).reasons).toContain('looping: Bash ×3')
  expect(newAlerts(b, cfg).some(a => a.key === 'loop:Bash:npm test')).toBe(true)

  let r = emptyBoard(0)
  for (const id of ['a', 'b', 'c', 'd']) r = ran(r, id, 'Read', '/src/big.ts')
  expect(loopWatch(r)).toBe(null)

  let f = emptyBoard(0)
  f = ran(f, 'a', 'Bash', 'tsc', 'fail')
  f = ran(f, 'b', 'Edit', '/src/x.ts')
  f = ran(f, 'c', 'Bash', 'tsc', 'fail')
  f = ran(f, 'd', 'Edit', '/src/x.ts')
  expect(loopWatch(f)).toBe(null)
  f = ran(f, 'e', 'Bash', 'tsc', 'fail')
  expect(loopWatch(f)).toEqual({ tool: 'Bash', detail: 'tsc', n: 3, failing: true })
})

test('tool results are weighed by the context they feed back', async () => {
  expect(estTokens('x'.repeat(4001))).toBe(1001)
  expect(estTokens(undefined)).toBe(0)
  let b = emptyBoard(0)
  b = finishCall(startCall(b, call('a', 'Read'), {}, ''), 'a', 'ok', 5, 3000)
  b = finishCall(startCall(b, call('b', 'Bash'), {}, ''), 'b', 'ok', 5, 1000)
  const w = ctxWeight(b)
  expect(w.map(x => x.tool)).toEqual(['Read', 'Bash'])
  expect(w[0]?.share).toBe(0.75)
  // A stat stored before `out` existed still reads.
  expect(toolBoard(normalize({ stats: { Grep: { n: 1, ok: 1, fail: 0, denied: 0, totalMs: 5, durs: [5] } } }))[0]?.out).toBe(0)
})

test('turns are split by model, and the budget runway follows the cost per turn', async () => {
  let b = emptyBoard(0)
  b = startTurn(b, 0, ctx(10, 0))
  b = endTurn(b, 1000, 1000, 'answer', ctx(12, 1), { model: 'opus', output_tokens: 300, input_tokens: 100 })
  b = startTurn(b, 2000, ctx(12, 1))
  b = endTurn(b, 3000, 1000, 'answer', ctx(13, 1.5), { model: 'haiku', output_tokens: 50 })
  const m = modelSplit(b)
  expect(m.map(x => x.model)).toEqual(['opus', 'haiku'])
  expect(Math.round((m[0]?.share ?? 0) * 1000)).toBe(667)
  expect(m[0]?.output).toBe(300)
  const budget = parseConfig({ budgetUsd: 4 })
  expect(budgetRunway(b, budget)).toBe(3)
  expect(budgetRunway(b, cfg)).toBe(null)
  expect(newAlerts(b, parseConfig({ budgetUsd: 3 })).map(a => a.key)).toContain('budget50')
})

test('daily totals add up, keep 60 days, and fill gaps with zero', async () => {
  const noon = new Date(2026, 10, 1, 12).getTime()
  expect(dayKey(noon)).toBe('2026-11-01')
  let l: Lifetime = { sessions: 0, usd: 0, turns: 0, calls: 0 }
  l = addDay(l, '2026-11-01', { turns: 1, usd: 0.5 })
  l = addDay(l, '2026-11-01', { turns: 2, usd: 0.25, calls: 4 })
  expect(l.days?.['2026-11-01']).toEqual({ sessions: 0, usd: 0.75, turns: 3, calls: 4 })
  for (let i = 1; i <= 70; i++) l = addDay(l, `2025-01-${String(i).padStart(2, '0')}`, { turns: 1 })
  expect(Object.keys(l.days ?? {}).length).toBe(60)
  expect(l.days?.['2026-11-01']).toBeTruthy()
  const days = lastDays(l, noon, 30)
  expect(days.length).toBe(30)
  expect(days[29]?.key).toBe('2026-11-01')
  expect(days[29]?.turns).toBe(3)
  expect(days[0]?.key).toBe('2026-10-03')
  expect(days[0]?.turns).toBe(0)
})

test('a rate limit filling at a steady pace gets a time to full, unless it resets first', async () => {
  const at = (min: number) => min * 60_000
  const lim = (pct: number, resetsAt: string | null) => ({ tokens: 1, window: 2, pct: 10, usd: 0, limits: [{ kind: 'five_hour', pct, resetsAt }] })
  const far = new Date(at(600)).toISOString()
  let b = emptyBoard(0)
  b = withCtx({ ...b, now: at(0) }, lim(40, far))
  b = withCtx({ ...b, now: at(10) }, lim(50, far))
  // 10% per 10 minutes, 50% to go: 50 minutes.
  expect(limitEta(b)[0]?.etaMs).toBe(at(50))
  expect(newAlerts(b, cfg).some(a => a.key === 'limit-eta-five_hour')).toBe(false)
  b = withCtx({ ...b, now: at(40) }, lim(80, far))
  expect(newAlerts(b, cfg).find(a => a.key === 'limit-eta-five_hour')?.text).toBe('Rate limit five hour full in ~20m00s at this pace')
  // A window that resets before it fills has no time to full.
  const soon = new Date(at(45)).toISOString()
  let r = emptyBoard(0)
  r = withCtx({ ...r, now: at(0) }, lim(40, soon))
  r = withCtx({ ...r, now: at(10) }, lim(50, soon))
  expect(limitEta(r)[0]?.etaMs).toBe(null)
  // Readings under five minutes apart are too few to call a pace.
  let q = emptyBoard(0)
  q = withCtx({ ...q, now: at(0) }, lim(40, far))
  q = withCtx({ ...q, now: at(2) }, lim(45, far))
  expect(limitEta(q)[0]?.etaMs).toBe(null)
})

test('the compaction warning fires two turns out and re-arms after a compaction', async () => {
  let b = emptyBoard(0)
  b = { ...b, comp: { model: '', total: 0, max: 100, compactAt: 80, autoCompact: true, slices: [], memory: [], mcp: [], at: 0 } }
  b = { ...b, ctx: ctx(70), turns: [5, 5, 5].map(d => ({ at: 0, ms: 1, usd: null, tools: 0, ctxDelta: d, reason: 'answer', model: '', tokens: null })) }
  expect(newAlerts(b, cfg).find(a => a.key === 'ctx-runway')?.text).toBe('Auto-compact in ~2 turns: consider /compact now')
  const raised = { ...b, alerts: ['ctx-runway'] }
  expect(newAlerts(raised, cfg).some(a => a.key === 'ctx-runway')).toBe(false)
  expect(compacted(raised).alerts).toEqual([])
})

test('the daily budget, long turns and quiet hours', async () => {
  const noon = new Date(2026, 10, 1, 12).getTime()
  const day = parseConfig({ dailyBudgetUsd: 10 })
  const b = { ...emptyBoard(0), now: noon }
  expect(newAlerts(b, day, 7).length).toBe(0)
  expect(newAlerts(b, day, 8.5).map(a => a.key)).toEqual(['day80:2026-11-01'])
  expect(newAlerts(b, day, 12).map(a => a.key)).toEqual(['day80:2026-11-01', 'day100:2026-11-01'])

  let t = startCall({ ...emptyBoard(0), running: true, turnStart: 0, turnCount: 3 }, { ...call('a', 'Bash'), detail: 'npm test' }, {}, '')
  t = { ...t, now: 11 * 60_000 }
  expect(newAlerts(t, cfg).find(a => a.key === 'long:3')?.text).toBe('Turn running 11m00s · last: Bash npm test')
  expect(newAlerts(t, parseConfig({ longTurnMin: 0 })).some(a => a.key.startsWith('long'))).toBe(false)

  const night = parseConfig({ quietHours: '22-7' })
  expect(night.quiet).toEqual([22, 7])
  expect(isQuiet(night, new Date(2026, 10, 1, 23).getTime())).toBe(true)
  expect(isQuiet(night, new Date(2026, 10, 1, 6).getTime())).toBe(true)
  expect(isQuiet(night, new Date(2026, 10, 1, 12).getTime())).toBe(false)
  expect(isQuiet(parseConfig({ quietHours: '9-17' }), new Date(2026, 10, 1, 12).getTime())).toBe(true)
  expect(parseConfig({ quietHours: 'later' }).quiet).toBe(null)
  expect(parseConfig({ quietHours: '5-5' }).quiet).toBe(null)
})

test('tool results are credited to their file by the context they fed', async () => {
  let b = emptyBoard(0)
  b = finishCall(startCall(b, call('a', 'Read'), { file: '/db/schema.sql' }, ''), 'a', 'ok', 5, 4000)
  b = finishCall(startCall(b, call('b', 'Read'), { file: '/db/schema.sql' }, ''), 'b', 'ok', 5, 2000)
  b = finishCall(startCall(b, call('c', 'Read'), { file: '/src/a.ts' }, ''), 'c', 'ok', 5, 900)
  b = finishCall(startCall(b, call('d', 'Edit'), { file: '/src/b.ts' }, ''), 'd', 'ok', 5, 0)
  expect(fileWeight(b).map(f => [f.path, f.out, f.read])).toEqual([
    ['/db/schema.sql', 6000, 2],
    ['/src/a.ts', 900, 1],
  ])
  expect(report(b, cfg, null)).toContain('Heaviest files (est.): /db/schema.sql 6k')
})

test('the branch comes from .git/HEAD, and a worktree .git file names the git directory', async () => {
  expect(parseHead('ref: refs/heads/feature/login\n')).toBe('feature/login')
  expect(parseHead('3f2a9c1e0b7d4a6f8e9c1b2a3d4e5f6a7b8c9d0e')).toBe('3f2a9c1')
  expect(parseHead(null)).toBe('')
  expect(parseHead('garbage')).toBe('')
  expect(gitDirOf('gitdir: /home/me/app/.git/worktrees/fix\n')).toBe('/home/me/app/.git/worktrees/fix')
  expect(gitDirOf(null)).toBe(null)
})

test('the last seven days are compared with the seven before', async () => {
  const noon = new Date(2026, 10, 14, 12).getTime()
  let l: Lifetime = { sessions: 0, usd: 0, turns: 0, calls: 0 }
  l = addDay(l, '2026-11-03', { usd: 10 })
  l = addDay(l, '2026-11-10', { usd: 12 })
  expect(weekCompare(l, noon)).toEqual({ week: 12, prior: 10, change: 0.2 })
  expect(weekCompare(null, noon).change).toBe(null)
})

// ---------------------------------------------------------------- guards and instruments

const runCall = (b: ReturnType<typeof emptyBoard>, id: string, tool: string, detail: string, status: 'ok' | 'fail', at: number, out = 0, file?: string) =>
  finishCall(startCall(b, { ...call(id, tool, at), detail }, { file }, ''), id, status, 10, out)

test('heavy jobs are judged by each command, never by its arguments', async () => {
  expect(commandHeads('FOO=1 rtk nice -n 10 npm test -- --watch && git status | head')).toEqual(['npm test --', 'git status', 'head'])
  for (const c of ['rtk npm test', 'nice -n 10 cargo build', 'cd x && npx vitest run', 'sudo docker build .', 'a; pnpm install'])
    expect(isHeavy(c, cfg)).toBe(true)
  for (const c of ['grep -n "test" file.ts', 'git commit -m "fix the build"', 'rtk grep build src/', 'echo test', 'cat tests/core.test.ts'])
    expect(isHeavy(c, cfg)).toBe(false)
})

test('wrappers and shells cannot hide a heavy job', async () => {
  for (const c of ['bash -c "npm test"', "sh -c 'cargo build --release'", 'timeout 600 npm test', 'timeout -k 5 10m cargo build', 'sudo -u ci docker build .', 'ionice -c 3 nice -n 19 pnpm install', '(cd app && npm run build)', 'nohup vitest run &', 'xargs -n 1 tsc'])
    expect(isHeavy(c, cfg)).toBe(true)
  expect(commandHeads('sudo -u bob ls -la')).toEqual(['ls -la'])
  expect(isHeavy('bash -c "echo test"', cfg)).toBe(false)
})

test('an unknown temperature never falls back to an old reading', async () => {
  const hot = withVitals(withVitals(emptyBoard(0), { tempC: 95, pct: 90, discharging: false, load1: 1, memPct: 40 }, 0), { tempC: 95, pct: 90, discharging: false, load1: 1, memPct: 40 }, 0)
  expect(steadyTemp(hot)).toBe(95)
  expect(steadyTemp(withVitals(hot, { tempC: null, pct: 90, discharging: false, load1: 1, memPct: 40 }, 0))).toBe(null)
})

test('the heat guard counts a hot laptop only when two readings agree', async () => {
  const at = (b: ReturnType<typeof emptyBoard>, t: number) => withVitals(b, { tempC: t, pct: 90, discharging: false, load1: 1, memPct: 40 }, 0)
  const spike = at(at(emptyBoard(0), 50), 93)
  expect(steadyTemp(spike)).toBe(50)
  const hot = at(spike, 91)
  expect(steadyTemp(hot)).toBe(91)
  expect(newAlerts(spike, cfg).some(a => a.key === 'hot')).toBe(false)
  expect(newAlerts(hot, cfg).some(a => a.key === 'hot')).toBe(true)
})

test('battery and memory limits join the heat guard only when set', async () => {
  const v = { tempC: 50, pct: 90, discharging: true, load1: 1, memPct: 95 }
  expect(refuse(v, cfg)).toBe(null)
  expect(refuse(v, parseConfig({ pauseOnBattery: true }))).toBe('running on battery')
  expect(refuse({ ...v, discharging: false }, parseConfig({ maxMemPct: 90 }))).toContain('memory at 95%')
  expect(refuse(v, parseConfig({ guard: false, pauseOnBattery: true }))).toBe(null)
})

test('the turn-cost stop trips once a live turn passes its limit', async () => {
  const c = parseConfig({ turnBudgetUsd: 0.5 })
  const live = startTurn(withCtx(emptyBoard(0), ctx(10, 1)), 1000, null)
  expect(turnOver(withCtx(live, ctx(12, 1.3)), c)).toBe(null)
  expect(turnOver(withCtx(live, ctx(12, 1.6)), c)).toContain('$0.60')
  expect(turnOver(withCtx(live, ctx(12, 9)), cfg)).toBe(null)
  expect(turnOver({ ...withCtx(live, ctx(12, 9)), running: false }, c)).toBe(null)
})

test('the loop breaker stops a third identical call, but not reads or a changed input', async () => {
  let b = emptyBoard(0)
  b = runCall(b, '1', 'Bash', 'npm run lint', 'fail', 1)
  expect(wouldLoop(b, 'Bash', 'npm run lint')).toBe(false)
  b = runCall(b, '2', 'Bash', 'npm run lint', 'fail', 2)
  expect(wouldLoop(b, 'Bash', 'npm run lint')).toBe(true)
  expect(wouldLoop(b, 'Bash', 'npm run lint -- --fix')).toBe(false)
  let r = emptyBoard(0)
  r = runCall(runCall(r, '1', 'Read', 'a.ts', 'ok', 1), '2', 'Read', 'a.ts', 'ok', 2)
  expect(wouldLoop(r, 'Read', 'a.ts')).toBe(false)
})

test('re-reads count the repeated tokens; failure streaks need two in a row', async () => {
  let b = emptyBoard(0)
  b = runCall(b, '1', 'Read', '/a.ts', 'ok', 1, 3000, '/a.ts')
  b = runCall(b, '2', 'Read', '/a.ts', 'ok', 2, 3000, '/a.ts')
  b = runCall(b, '3', 'Read', '/b.ts', 'ok', 3, 500, '/b.ts')
  expect(rereads(b)).toMatchObject({ waste: 3000, rows: [{ path: '/a.ts', read: 2 }] })
  b = runCall(b, '4', 'Bash', 'make', 'fail', 4)
  expect(streaks(b)).toEqual([])
  b = runCall(b, '5', 'Bash', 'make', 'fail', 5)
  expect(streaks(b)).toEqual([{ tool: 'Bash', n: 2, detail: 'make' }])
  b = runCall(b, '6', 'Bash', 'make', 'ok', 6)
  expect(streaks(b)).toEqual([])
})

test('a turn records what fed it, and insights name the priciest turn', async () => {
  let b = startTurn(withCtx(emptyBoard(0), ctx(10, 0)), 100, null)
  b = runCall(b, '1', 'Read', '/big.json', 'ok', 200, 32000, '/big.json')
  b = runCall(b, '2', 'Bash', 'ls', 'ok', 300, 50)
  expect(turnFeed(b, 100)).toEqual([{ name: '/big.json', out: 32000 }, { name: 'Bash', out: 50 }])
  b = endTurn(b, 400, 300, 'answer', ctx(30, 0.4))
  expect(b.turns[0]?.fed?.[0]).toEqual({ name: '/big.json', out: 32000 })
  const ins = insights(b, cfg)
  expect(Math.round((ins.costly?.usd ?? 0) * 100)).toBe(40)
  expect(ins.tips.some(t => t.startsWith('Read results are'))).toBe(true)
})

test('subagents add up their tokens', async () => {
  let b = spawnAgent(emptyBoard(0), { id: 'a', type: 'Explore', desc: '', model: '', status: 'run', startedAt: 0, endedAt: null, tools: 0 })
  b = endAgent(b, 'a', 'answer', 10, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000 })
  expect(b.agents[0]).toMatchObject({ status: 'done', tokens: 1120 })
  expect(endAgent(b, 'a', 'answer', 20).agents[0]?.tokens).toBe(1120)
})

test('session history keeps one line per session, the last 20', async () => {
  const b = withCtx({ ...emptyBoard(500), now: 6500, turnCount: 3, branch: 'main' }, ctx(10, 0.25))
  const s = sessionStat(b, cfg)
  expect(s).toMatchObject({ at: 500, ms: 6000, usd: 0.25, turns: 3, grade: 'A', branch: 'main' })
  let l: Lifetime = { sessions: 0, usd: 0, turns: 0, calls: 0 }
  l = withSession(l, s)
  l = withSession(l, { ...s, turns: 4 })
  expect(l.recent).toEqual([{ ...s, turns: 4 }])
  for (let i = 0; i < 30; i++) l = withSession(l, { ...s, at: 1000 + i })
  expect(l.recent?.length).toBe(20)
  expect(l.recent?.[19]?.at).toBe(1029)
})

test('status line presets', async () => {
  const b = withCtx(emptyBoard(0), ctx(42, 1.5))
  expect(statusLine(b, cfg)).toBe('A · idle · ctx 42% · $1.50')
  expect(statusLine(b, parseConfig({ statusLine: 'minimal' }))).toBe('A · idle · ctx 42%')
  expect(statusLine(b, parseConfig({ statusLine: 'cost' }))?.startsWith('$1.50')).toBe(true)
  expect(statusLine(b, parseConfig({ statusLine: 'off' }))).toBe(undefined)
  expect(parseConfig({ statusLine: 'loud' }).statusLine).toBe('full')
})

test('export: JSON parses back and CSV quotes what it must', async () => {
  let b = startTurn(withCtx(emptyBoard(0), ctx(10, 0)), 100, null)
  b = runCall(b, '1', 'Read', '/x,"y".ts', 'ok', 200, 900, '/x,"y".ts')
  b = endTurn(b, 400, 300, 'answer', ctx(12, 0.1))
  const json = JSON.parse(exportJson(b, cfg, null))
  expect(json.turns.length).toBe(1)
  expect(json.health.grade).toBe('A')
  const csv = turnsCsv(b).split('\n')
  expect(csv[0]?.startsWith('at,ms,usd,')).toBe(true)
  expect(csv[1]?.endsWith('"/x,""y"".ts 900"')).toBe(true)
})

test('CSV text that a spreadsheet would run as a formula is neutralised; numbers stay numbers', async () => {
  let b = startTurn(withCtx(emptyBoard(0), ctx(30, 0)), 100, null)
  b = { ...endTurn(b, 400, 300, 'answer', ctx(20, 0.1), { model: '=HYPERLINK("http://x")' }) }
  const row = turnsCsv(b).split('\n')[1] ?? ''
  expect(row).toContain(`"'=HYPERLINK(""http://x"")"`)
  expect(row).toContain(',-10.0,')
})
