import { expect, test } from 'claude-code/testing'

import {
  addBranch,
  addTest,
  branchBoard,
  CACHE_LONG,
  CACHE_SHORT,
  cacheText,
  cacheWarmth,
  churn,
  emptyBoard,
  endJob,
  endTurn,
  finishCall,
  idleMcp,
  insights,
  isTestCommand,
  mcpLoad,
  newAlerts,
  normalize,
  openJobs,
  parseConfig,
  parseNotices,
  parseTests,
  report,
  sinceCommit,
  startCall,
  startJob,
  startTurn,
  trackMcp,
  whatIf,
  withCtx,
} from '../hooks/core'
import type { Board, Call, Composition, Lifetime } from '../types'

const cfg = parseConfig({})
const ctx = (pct: number, usd = 0) => ({ tokens: pct * 2000, window: 200000, pct, usd, limits: [] })
const call = (id: string, tool: string, at = 1000): Call => ({ id, tool, detail: '', status: 'run', agent: false, at, ms: null })
const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, model = 'claude-opus-5-5') => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model,
})

// One finished main-thread turn from `start` to `end`.
const turn = (b: Board, start: number, end: number, before: number, after: number, u = usage(1000, 1000, 0, 0)) =>
  endTurn(startTurn(b, start, ctx(before, b.ctx?.usd ?? 0)), end, end - start, 'answer', ctx(after, (b.ctx?.usd ?? 0) + 1), u)

test('an older stored board gains the new fields', async () => {
  const b = normalize({ turnCount: 2 })
  expect(b.cacheTtl).toBe(CACHE_SHORT)
  expect(b.jobs).toEqual([])
  expect(b.tests).toEqual([])
  expect(b.lastCompact).toBe(null)
  expect(b.commitAt).toBe(null)
})

test('the cache counts down from the last reply and learns an hour-long cache', async () => {
  let b = turn(withCtx(emptyBoard(0), ctx(40)), 0, 10_000, 40, 45)
  expect(cacheWarmth({ ...b, now: 70_000 })?.leftMs).toBe(CACHE_SHORT - 60_000)
  expect(cacheText({ ...b, now: 70_000 })).toBe('cache 4m00s')
  expect(cacheText({ ...b, now: 10_000 + CACHE_SHORT })).toBe('cache cold')
  expect(cacheWarmth({ ...b, running: true })).toBe(null)
  // Ten idle minutes, then a reply that rewrote little of the 90k-token window: the cache had stayed warm.
  b = turn(b, 10_000 + 10 * 60_000, 10_000 + 11 * 60_000, 45, 46, usage(500, 800, 85_000, 2_000))
  expect(b.cacheTtl).toBe(CACHE_LONG)
  // A cold restart after the same gap rewrites the window and teaches nothing.
  let c = turn(withCtx(emptyBoard(0), ctx(40)), 0, 10_000, 40, 45)
  c = turn(c, 10_000 + 10 * 60_000, 10_000 + 11 * 60_000, 45, 46, usage(500, 800, 0, 90_000))
  expect(c.cacheTtl).toBe(CACHE_SHORT)
})

test('the cache alert is opt-in and fires once a minute before the cache goes cold', async () => {
  const b = turn(withCtx(emptyBoard(0), ctx(40)), 0, 10_000, 40, 45)
  const late = { ...b, now: 10_000 + CACHE_SHORT - 30_000 }
  expect(newAlerts(late, cfg).some(a => a.key.startsWith('cache'))).toBe(false)
  const on = parseConfig({ cacheAlert: true })
  expect(newAlerts(late, on).some(a => a.key.startsWith('cache'))).toBe(true)
  expect(newAlerts({ ...b, now: 20_000 }, on).some(a => a.key.startsWith('cache'))).toBe(false)
})

const comp = (mcp: Composition['mcp']): Composition => ({ model: '', total: 0, max: 0, compactAt: null, autoCompact: false, slices: [], memory: [], mcp, at: 0 })

test('MCP servers that sit loaded and uncalled are found, and their idle run counts once per session', async () => {
  let b: Board = {
    ...emptyBoard(100),
    comp: comp([
      { name: 'mcp__github__search', server: 'github', tokens: 3000, loaded: true },
      { name: 'mcp__github__pr', server: 'github', tokens: 2000, loaded: true },
      { name: 'mcp__slack__post', server: 'slack', tokens: 1500, loaded: true },
      { name: 'mcp__drive__find', server: 'drive', tokens: 900, loaded: false },
    ]),
  }
  b = finishCall(startCall(b, call('1', 'mcp__slack__post'), {}, ''), '1', 'ok', 10)
  expect(mcpLoad(b)).toEqual([
    { server: 'github', tokens: 5000, calls: 0 },
    { server: 'slack', tokens: 1500, calls: 1 },
  ])
  let l: Lifetime = { sessions: 0, usd: 0, turns: 0, calls: 0 }
  l = trackMcp(trackMcp(l, b), b)
  expect(l.mcp?.github?.idle).toBe(1)
  expect(l.mcp?.slack?.idle).toBe(0)
  l = trackMcp(l, { ...b, startedAt: 200 })
  expect(l.mcp?.github?.idle).toBe(2)
  expect(idleMcp(b, l)).toEqual([{ server: 'github', tokens: 5000, sessions: 2 }])
  const tips = insights({ ...b, turnCount: 3 }, cfg).tips
  expect(tips.some(t => t.includes('1 MCP server holds ~5k tokens'))).toBe(true)
})

test('what-if reprices main-thread turns at cheaper list prices, leaving out turns that ran subagents', async () => {
  let b = withCtx(emptyBoard(0), ctx(10))
  b = turn(b, 0, 10_000, 10, 12, usage(1_000_000, 100_000, 0, 0))
  expect(b.turns[0]?.usd).toBe(1)
  // Sonnet 5.5 would cost $3 (1M in at $2, 100k out at $10), more than the $1 paid, so only Haiku is listed.
  const rows = whatIf(b)
  expect(rows.map(r => r.model)).toEqual(['Haiku 5.5'])
  expect(whatIf({ ...b, turns: b.turns.map(t => ({ ...t, usd: 5 })) })[0]).toMatchObject({ model: 'Sonnet 5.5', usd: 3, actual: 5 })
  expect(rows.find(r => r.model === 'Haiku 5.5')?.usd).toBe(0.15)
  // Over 100k tokens in the window, Haiku charges five times as much.
  const big = { ...b, turns: b.turns.map(t => ({ ...t, ctxTokens: 150_000 })) }
  expect(whatIf(big).find(r => r.model === 'Haiku 5.5')?.usd).toBe(0.75)
  expect(whatIf({ ...b, model: 'claude-haiku-5-5' })).toEqual([])
  expect(whatIf({ ...b, agents: [{ id: 'a', type: 'Explore', desc: '', model: '', status: 'done', startedAt: 5000, endedAt: 8000, tools: 1 }] })).toEqual([])
})

test('test output is counted for each runner, totals winning over per-file lines', async () => {
  expect(parseTests('Test Suites: 1 failed, 3 passed, 4 total\nTests:       2 failed, 10 passed, 12 total')).toEqual({ pass: 10, fail: 2 })
  expect(parseTests(' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 10 passed (12)')).toEqual({ pass: 10, fail: 2 })
  expect(parseTests('===== 1 failed, 41 passed in 2.31s =====')).toEqual({ pass: 41, fail: 1 })
  expect(parseTests('test result: ok. 7 passed; 0 failed\ntest result: FAILED. 3 passed; 1 failed')).toEqual({ pass: 10, fail: 1 })
  expect(parseTests('  12 passing (2s)\n  1 failing')).toEqual({ pass: 12, fail: 1 })
  expect(parseTests('# tests 5\n# pass 4\n# fail 1')).toEqual({ pass: 4, fail: 1 })
  expect(parseTests('--- PASS: TestA\n--- FAIL: TestB\n--- PASS: TestC')).toEqual({ pass: 2, fail: 1 })
  expect(parseTests('===== 10 passed, 2 errors in 1.2s =====')).toEqual({ pass: 10, fail: 2 })
  expect(parseTests('===== 1 error in 0.3s =====')).toEqual({ pass: 0, fail: 1 })
  expect(parseTests('Finished in 0.5 seconds\n10 examples, 2 failures')).toEqual({ pass: 8, fail: 2 })
  expect(parseTests('Tests: 10, Assertions: 20, Errors: 1, Failures: 2.')).toEqual({ pass: 7, fail: 3 })
  expect(parseTests('OK (12 tests, 30 assertions)')).toEqual({ pass: 12, fail: 0 })
  expect(parseTests('nothing to see')).toBe(null)
  expect(parseTests(undefined)).toBe(null)
  for (const c of ['rtk npm test', 'npx vitest run', 'cargo test', 'go test ./...', 'claude plugin test .', 'uv run pytest -q', 'node --test', './gradlew test', 'vendor/bin/phpunit', './node_modules/.bin/jest', 'bundle exec rspec', 'python -m unittest', 'just test', 'cargo nextest run'])
    expect(isTestCommand(c)).toBe(true)
  for (const c of ['git commit -m "add tests"', 'cat tests/core.test.ts', 'grep test src', 'test -f package.json && npm run build', 'npm run build --test-only'])
    expect(isTestCommand(c)).toBe(false)
  let b = emptyBoard(0)
  for (let i = 0; i < 25; i++) b = addTest(b, { at: i, cmd: 'npm test', pass: 1, fail: 0 })
  expect(b.tests.length).toBe(20)
})

test('background jobs open, close by id, and alert once if still running after the turn', async () => {
  let b = turn(withCtx(emptyBoard(0), ctx(10)), 0, 10_000, 10, 12)
  b = startJob(b, { id: 'bx1', cmd: 'npm run dev', at: 5000, end: null, status: 'run' })
  b = startJob(b, { id: 'bx2', cmd: 'npm test', at: 6000, end: null, status: 'run' })
  expect(openJobs(b).length).toBe(2)
  b = endJob(b, 'bx2', 'completed', 9000)
  expect(openJobs(b).map(j => j.id)).toEqual(['bx1'])
  expect(endJob(b, 'nope', 'killed', 1)).toBe(b)
  expect(newAlerts({ ...b, now: 60_000 }, cfg).some(a => a.key === 'job:bx1')).toBe(false)
  expect(newAlerts({ ...b, now: 140_000 }, cfg).some(a => a.key === 'job:bx1')).toBe(true)
  expect(parseNotices('<task-notification>\n<task-id>bx1</task-id>\n<status>completed</status>\n</task-notification>')).toEqual([{ id: 'bx1', status: 'completed' }])
  expect(parseNotices('<task-notification><task-id>a</task-id><status>completed</status></task-notification>\n<task-notification><task-id>b</task-id></task-notification>')).toEqual([
    { id: 'a', status: 'completed' },
    { id: 'b', status: 'ended' },
  ])
  expect(parseNotices('<task-id>bx9</task-id>')).toEqual([{ id: 'bx9', status: 'ended' }])
  expect(parseNotices('just text')).toEqual([])
})

test('branch spend adds up across sessions, each counted once', async () => {
  let l: Lifetime = { sessions: 0, usd: 0, turns: 0, calls: 0 }
  l = addBranch(l, 'main', 100, 1.5, 1000)
  l = addBranch(l, 'main', 100, 0.5, 2000)
  l = addBranch(l, 'feat/x', 300, 4, 3000)
  l = addBranch(l, 'main', 500, 1, 4000)
  l = addBranch(l, '', 500, 9, 5000)
  expect(branchBoard(l)).toEqual([
    { branch: 'feat/x', usd: 4, turns: 1, sessions: 1, last: 3000, session: 300 },
    { branch: 'main', usd: 3, turns: 3, sessions: 2, last: 4000, session: 500 },
  ])
})

test('changes since the last commit and files changed again and again', async () => {
  let b = emptyBoard(0)
  const ran = (x: Board, id: string, tool: string, at: number, file: string, status: 'ok' | 'fail' | 'denied' = 'ok') => finishCall(startCall(x, call(id, tool, at), { file }, ''), id, status, 10)
  for (let i = 0; i < 6; i++) b = ran(b, `e${i}`, 'Edit', 1000 + i, '/a.ts')
  b = ran(b, 'w', 'Write', 5000, '/b.ts')
  b = ran(b, 'r', 'Read', 6000, '/c.ts')
  // A denied or failed edit changed nothing; a scratch file outside the project is not uncommitted work.
  b = ran(b, 'd', 'Edit', 7000, '/d.ts', 'denied')
  b = ran(b, 'f', 'Edit', 7100, '/e.ts', 'fail')
  b = ran(b, 't', 'Write', 7200, '/tmp/scratch.txt')
  expect(sinceCommit(b)).toBe(null)
  expect(sinceCommit({ ...b, commitAt: 0, root: '/' })?.files).toEqual(['/tmp/scratch.txt', '/b.ts', '/a.ts'])
  expect(sinceCommit({ ...b, commitAt: 0, root: '/tmp' })?.files).toEqual(['/tmp/scratch.txt'])
  const c = { ...b, commitAt: 3000, now: 3000 + 40 * 60_000 }
  expect(sinceCommit({ ...c, root: '/' })).toEqual({ files: ['/tmp/scratch.txt', '/b.ts'], ago: 40 * 60_000 })
  expect(sinceCommit({ ...c, root: '/repo' })?.files).toEqual([])
  expect(sinceCommit({ ...c, commitAt: 0 })?.files).toEqual(['/tmp/scratch.txt', '/b.ts', '/a.ts'])
  expect(churn(b).map(f => f.path)).toEqual(['/a.ts'])
  expect(insights(b, cfg).tips.some(t => t.startsWith('/a.ts changed 6 times'))).toBe(true)
})

test('the report carries the new instruments', async () => {
  let b = turn(withCtx(emptyBoard(0), ctx(10)), 0, 10_000, 10, 12, usage(100_000, 10_000, 0, 0))
  b = addTest(b, { at: 9000, cmd: 'npm test', pass: 10, fail: 2 })
  b = startJob(b, { id: 'j', cmd: 'npm run dev', at: 9000, end: null, status: 'run' })
  b = { ...b, lastCompact: { at: 8000, trigger: 'auto', before: 180_000, after: 20_000, fed: [{ name: 'core.ts', out: 9000 }] } }
  const life: Lifetime = addBranch({ sessions: 1, usd: 1, turns: 1, calls: 0 }, 'main', 0, 1, 10_000)
  const r = report({ ...b, now: 12_000 }, cfg, life)
  for (const s of ['Prompt cache: cache 4m58s left', 'Same main-thread tokens at list price', 'Last compaction', '180k → 20k', 'Tests: last run 10 passed, 2 failed', 'Background jobs running: `npm run dev`', 'By branch (all time): main $1.00'])
    expect(r).toContain(s)
})
