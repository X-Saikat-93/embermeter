// Pure logic: no `$`, no I/O. Everything here is unit-tested in tests/core.test.ts.
import type { Agent, AgentStatus, Board, BranchStat, Call, CallStatus, Composition, Ctx, DayStat, FileStat, Job, Lifetime, Limit, LimitTrack, LogKind, ModelStat, SessionStat, TestRun, Tokens, ToolStat, Turn, Vitals } from '../types'

export type Theme = 'night' | 'day' | 'washi' | 'contrast'
export type Motion = 'smooth' | 'reduced' | 'off'
export type StatusPreset = 'full' | 'minimal' | 'cost' | 'off'
export type TermDraw = 'graphics' | 'text'

export type Cfg = {
  theme: Theme
  motion: Motion
  maxTempC: number
  minBatteryPct: number
  guard: boolean
  heavy: RegExp
  prefix: string
  budgetUsd: number
  dailyBudgetUsd: number
  longTurnMin: number
  // Hours with no toasts, [start, end) in local time; null when off.
  quiet: [number, number] | null
  threads: number
  openOnStart: boolean
  band: boolean
  alerts: boolean
  // Guardrails, all off by default.
  turnBudgetUsd: number
  loopBreak: boolean
  pauseOnBattery: boolean
  maxMemPct: number
  // A toast a minute before the prompt cache goes cold; off by default.
  cacheAlert: boolean
  // Presentation.
  statusLine: StatusPreset
  terminal: TermDraw
}

// A heavy word must stand alone, so paths and file names (`tests/a.test.ts`, `vite.config.ts`, `--ci`) don't count.
const DEFAULT_HEAVY = '(?<![\\w./-])(build|test|vitest|jest|playwright|tsc|lint|install|ci|docker|webpack|vite|next|prisma\\s+migrate|cargo|e2e)(?![\\w./-])'

// CPU sensors first: ACPI and Wi-Fi zones often report stale or trip-point values well above the real die temperature.
const CPU_ZONE = /^(x86_pkg_temp|TCPU|coretemp|k10temp|cpu[-_]?thermal|soc[-_]?thermal|cpu)/i

export const pickTemp = (zones: readonly { type: string; milli: number | null }[]): number | null => {
  const ok = zones.filter((z): z is { type: string; milli: number } => z.milli !== null && z.milli > 0 && z.milli < 130_000)
  const cpu = ok.filter(z => CPU_ZONE.test(z.type))
  const pool = cpu.length ? cpu : ok
  return pool.length ? Math.max(...pool.map(z => z.milli)) / 1000 : null
}

// "0-15" or "0,2-5" from /sys/devices/system/cpu/online.
export const countCpus = (online: string | null): number | null => {
  if (!online) return null
  let n = 0
  for (const part of online.trim().split(',')) {
    const [a, b] = part.split('-').map(Number)
    if (a === undefined || !Number.isFinite(a)) return null
    n += b !== undefined && Number.isFinite(b) ? b - a + 1 : 1
  }
  return n > 0 ? n : null
}

// "22-7" → [22, 7]: start and end hour, local time. Anything else turns quiet hours off.
const parseQuiet = (v: unknown): [number, number] | null => {
  const m = typeof v === 'string' ? /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(v) : null
  if (!m) return null
  const a = Number(m[1])
  const z = Number(m[2]) % 24
  return a <= 23 && a !== z ? [a, z] : null
}

export const parseConfig = (o: Readonly<Record<string, unknown>> = {}): Cfg => {
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d
  }
  let heavy: RegExp
  try {
    heavy = new RegExp(typeof o.heavyPattern === 'string' && o.heavyPattern ? o.heavyPattern : DEFAULT_HEAVY)
  } catch {
    heavy = new RegExp(DEFAULT_HEAVY)
  }
  return {
    theme: o.theme === 'night' || o.theme === 'day' || o.theme === 'contrast' ? o.theme : 'washi',
    motion: o.motion === 'reduced' || o.motion === 'off' ? o.motion : 'smooth',
    maxTempC: num(o.maxTempC, 80, 40, 110),
    minBatteryPct: num(o.minBatteryPct, 20, 0, 100),
    guard: o.guard !== false,
    heavy,
    prefix: typeof o.commandPrefix === 'string' ? o.commandPrefix.trim() : '',
    budgetUsd: num(o.budgetUsd, 0, 0, 100000),
    dailyBudgetUsd: num(o.dailyBudgetUsd, 0, 0, 100000),
    longTurnMin: num(o.longTurnMin, 10, 0, 1440),
    quiet: parseQuiet(o.quietHours),
    // 0 means detect from the machine; register.tsx fills it in.
    threads: num(o.threads, 0, 0, 512),
    openOnStart: o.openOnStart !== false,
    band: o.band !== false,
    alerts: o.alerts !== false,
    turnBudgetUsd: num(o.turnBudgetUsd, 0, 0, 100000),
    loopBreak: o.loopBreak === true,
    pauseOnBattery: o.pauseOnBattery === true,
    maxMemPct: num(o.maxMemPct, 0, 0, 100),
    cacheAlert: o.cacheAlert === true,
    statusLine: o.statusLine === 'minimal' || o.statusLine === 'cost' || o.statusLine === 'off' ? o.statusLine : 'full',
    terminal: o.terminalDrawing === 'text' ? 'text' : 'graphics',
  }
}

// ---------------------------------------------------------------- board

// How long the prompt cache outlives a reply: five minutes by default, an hour where the account caches for longer.
export const CACHE_SHORT = 5 * 60_000
export const CACHE_LONG = 60 * 60_000

export const emptyBoard = (startedAt = 0): Board => ({
  startedAt,
  now: startedAt,
  vitals: null,
  ctx: null,
  comp: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  model: '',
  running: false,
  turnStart: 0,
  turnTools: 0,
  turnCtxStart: null,
  costAtStart: null,
  turns: [],
  turnCount: 0,
  models: {},
  limitHist: {},
  branch: '',
  calls: [],
  stats: {},
  files: {},
  bash: { total: 0, prefixed: 0 },
  gate: { allow: 0, ask: 0, deny: 0 },
  agents: [],
  log: [],
  ctxHist: [],
  tempHist: [],
  activity: [0],
  activityMinute: 0,
  compactions: 0,
  guardBlocks: 0,
  alerts: [],
  cacheTtl: CACHE_SHORT,
  lastCompact: null,
  tests: [],
  jobs: [],
  commitAt: null,
})

// A value stored by an older version is merged over the defaults, so a reload never meets a missing field.
export const normalize = (b: unknown): Board => {
  const base = emptyBoard()
  if (!b || typeof b !== 'object') return base
  const merged = { ...base, ...(b as Partial<Board>) }
  return {
    ...merged,
    bash: { ...base.bash, ...merged.bash },
    gate: { ...base.gate, ...merged.gate },
    tokens: { ...base.tokens, ...merged.tokens },
    models: merged.models ?? {},
    limitHist: merged.limitHist ?? {},
    branch: merged.branch ?? '',
    turns: (merged.turns ?? []).map(t => ({ ...t, model: t.model ?? '', tokens: t.tokens ?? null })),
    activity: Array.isArray(merged.activity) && merged.activity.length ? merged.activity : [0],
  }
}

export const tail = <T>(list: T[], item: T, max: number): T[] => [...list, item].slice(-max)

export const log = (b: Board, at: number, who: string, text: string, kind: LogKind = 'info'): Board => ({
  ...b,
  log: tail(b.log, { at, who: short(who, 14), text: short(text, 110), kind }, 60),
})

const FILE_KIND: Record<string, keyof Omit<FileStat, 'last' | 'out' | 'lastEdit'>> = {
  Read: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
}

const bump = (b: Board, at: number): Board => {
  const minute = Math.max(0, Math.floor((at - b.startedAt) / 60000))
  let activity = b.activity
  let current = b.activityMinute
  if (minute > current) {
    const gap = Math.min(minute - current, 60)
    activity = [...activity, ...Array(gap).fill(0)]
    current = minute
  }
  activity = activity.slice(-60)
  const last = activity.length - 1
  return { ...b, activity: activity.map((n, i) => (i === last ? n + 1 : n)), activityMinute: current }
}

export const startCall = (b: Board, call: Call, input: { file?: string; command?: string; agentId?: string }, prefix: string): Board => {
  const kept: Call = input.file ? { ...call, file: input.file } : call
  let next = bump({ ...b, calls: tail(b.calls, kept, 60), turnTools: b.turnTools + (call.agent ? 0 : 1) }, call.at)
  const kind = FILE_KIND[call.tool]
  if (kind && input.file) {
    const f = next.files[input.file] ?? { read: 0, edit: 0, write: 0, last: 0 }
    const changed = kind === 'read' ? {} : { lastEdit: call.at }
    next = { ...next, files: { ...next.files, [input.file]: { ...f, [kind]: f[kind] + 1, last: call.at, ...changed } } }
  }
  if (call.tool === 'Bash' && input.command !== undefined) {
    const isPrefixed = prefix !== '' && input.command.trim().startsWith(`${prefix} `)
    next = { ...next, bash: { total: next.bash.total + 1, prefixed: next.bash.prefixed + (isPrefixed ? 1 : 0) } }
  }
  if (input.agentId) {
    next = { ...next, agents: next.agents.map(a => (a.id === input.agentId ? { ...a, tools: a.tools + 1 } : a)) }
  }
  return next
}

// ponytail: about four characters per token; a real tokenizer would need a dependency or a model call.
export const estTokens = (s: unknown) => (typeof s === 'string' ? Math.ceil(s.length / 4) : 0)

// `out`: estimated tokens of the result the model reads back.
export const finishCall = (b: Board, id: string, status: CallStatus, ms: number, out = 0): Board => {
  const call = b.calls.find(c => c.id === id)
  if (!call) return b
  const s: ToolStat = b.stats[call.tool] ?? { n: 0, ok: 0, fail: 0, denied: 0, totalMs: 0, durs: [] }
  const stat: ToolStat = {
    n: s.n + 1,
    ok: s.ok + (status === 'ok' ? 1 : 0),
    fail: s.fail + (status === 'fail' ? 1 : 0),
    denied: s.denied + (status === 'denied' ? 1 : 0),
    totalMs: s.totalMs + (status === 'denied' ? 0 : ms),
    durs: status === 'denied' ? s.durs : tail(s.durs, ms, 50),
    out: (s.out ?? 0) + out,
  }
  const f = call.file ? b.files[call.file] : undefined
  return {
    ...b,
    calls: b.calls.map(c => (c.id === id ? { ...c, status, ms, out } : c)),
    stats: { ...b.stats, [call.tool]: stat },
    files: f && call.file && out > 0 ? { ...b.files, [call.file]: { ...f, out: (f.out ?? 0) + out } } : b.files,
  }
}

export const spawnAgent = (b: Board, a: Agent): Board => ({ ...b, agents: tail(b.agents.filter(x => x.id !== a.id), a, 40) })

// `usage`: the subagent turn's token usage, added to what it has reported so far.
export const endAgent = (b: Board, id: string, reason: string, at: number, usage: Usage | null = null): Board => {
  const status: AgentStatus = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'fail'
  const t = toTokens(usage)
  const add = t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0
  return { ...b, agents: b.agents.map(a => (a.id === id ? { ...a, status, endedAt: at, tokens: (a.tokens ?? 0) + add } : a)) }
}

// What fed the context during the turn that started at `since`: each file (or, without one, each tool) by estimated
// tokens, heaviest first.
export const turnFeed = (b: Board, since: number, n = 3): { name: string; out: number }[] => {
  const by: Record<string, number> = {}
  for (const c of b.calls) {
    if (c.agent || c.at < since || !c.out) continue
    const key = c.file ? shortPath(c.file, 40) : c.tool
    by[key] = (by[key] ?? 0) + c.out
  }
  return Object.entries(by)
    .map(([name, out]) => ({ name, out }))
    .sort((x, y) => y.out - x.out)
    .slice(0, n)
}

export const startTurn = (b: Board, at: number, ctx: Ctx | null): Board => ({
  ...b,
  running: true,
  now: at,
  turnStart: at,
  turnTools: 0,
  turnCount: b.turnCount + 1,
  ctx: ctx ?? b.ctx,
  costAtStart: ctx?.usd ?? b.ctx?.usd ?? null,
  turnCtxStart: (ctx ?? b.ctx)?.pct ?? null,
})

export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; model?: string }

export const toTokens = (u: Usage | null | undefined): Tokens | null =>
  u ? { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 } : null

const addTokens = (a: Tokens, b: Tokens | null): Tokens =>
  b ? { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite } : a

export const endTurn = (b: Board, at: number, ms: number | null, reason: string, ctx: Ctx | null, usage: Usage | null = null): Board => {
  const c = ctx ?? b.ctx
  const tokens = toTokens(usage)
  const model = usage?.model ?? b.model
  // A reply after more than five idle minutes that rewrote under half of what the window held found the cache still
  // warm, so this account's cache lasts an hour. Anything less certain keeps the five-minute default.
  const prev = b.turns[b.turns.length - 1]
  const idle = prev ? b.turnStart - prev.at : 0
  const held = b.turnCtxStart !== null && c?.window ? (b.turnCtxStart / 100) * c.window : 0
  const warm = tokens !== null && idle > CACHE_SHORT + 30_000 && idle < CACHE_LONG && held > 10_000 && tokens.cacheWrite < held / 2
  const turn: Turn = {
    at,
    ms: ms ?? Math.max(0, at - b.turnStart),
    usd: c?.usd != null && b.costAtStart !== null ? Math.max(0, c.usd - b.costAtStart) : null,
    tools: b.turnTools,
    ctxDelta: c?.pct != null && b.turnCtxStart !== null ? c.pct - b.turnCtxStart : null,
    reason,
    model,
    tokens,
    fed: turnFeed(b, b.turnStart),
    ctxTokens: c?.tokens ?? null,
  }
  const key = model || 'unknown'
  const m: ModelStat = b.models[key] ?? { turns: 0, usd: 0, input: 0, output: 0 }
  const models = {
    ...b.models,
    [key]: {
      turns: m.turns + 1,
      usd: m.usd + (turn.usd ?? 0),
      input: m.input + (tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite : 0),
      output: m.output + (tokens?.output ?? 0),
    },
  }
  return { ...b, running: false, now: at, ctx: c, model, tokens: addTokens(b.tokens, tokens), turns: tail(b.turns, turn, 40), models, cacheTtl: warm ? CACHE_LONG : b.cacheTtl }
}

// The engine's /context breakdown, reduced to what the dashboard draws.
export const toComposition = (bd: any, at: number): Composition | null => {
  if (!bd || !Array.isArray(bd.categories)) return null
  return {
    model: String(bd.model ?? ''),
    total: Number(bd.totalTokens) || 0,
    max: Number(bd.maxTokens) || 0,
    compactAt: typeof bd.autoCompactThreshold === 'number' ? bd.autoCompactThreshold : null,
    autoCompact: Boolean(bd.isAutoCompactEnabled),
    slices: bd.categories
      .filter((c: any) => !c.isDeferred && Number(c.tokens) > 0)
      .map((c: any) => ({ name: String(c.name), tokens: Number(c.tokens), kind: String(c.kind ?? '') })),
    memory: (bd.memoryFiles ?? []).map((m: any) => ({ path: String(m.path), tokens: Number(m.tokens) || 0 })).sort((x: any, y: any) => y.tokens - x.tokens),
    mcp: (bd.mcpTools ?? []).map((t: any) => ({ name: String(t.name), server: String(t.serverName), tokens: Number(t.tokens) || 0, loaded: Boolean(t.isLoaded) })).sort((x: any, y: any) => y.tokens - x.tokens),
    at,
  }
}

// Where compaction kicks in, as a percent of the window; 100 when auto-compact is off or unknown.
export const compactPct = (b: Board) => {
  const c = b.comp
  if (!c || !c.autoCompact || !c.compactAt || !c.max) return 100
  return Math.min(100, (c.compactAt / c.max) * 100)
}

export const cacheHit = (t: Tokens) => {
  const read = t.input + t.cacheRead + t.cacheWrite
  return read ? t.cacheRead / read : null
}

// Output tokens per second over the recent turns that reported usage.
export const throughput = (b: Board) => {
  const recent = b.turns.filter(t => t.tokens && t.ms > 0).slice(-8)
  const out = recent.reduce((s, t) => s + (t.tokens?.output ?? 0), 0)
  const ms = recent.reduce((s, t) => s + t.ms, 0)
  return ms > 0 && out > 0 ? out / (ms / 1000) : null
}

// Each rate-limit window's readings, kept only while the window is the same one (same reset time), and only when
// the reading moves, so the first and last points give the pace at which it fills.
const trackLimits = (hist: Record<string, LimitTrack>, limits: Limit[], at: number): Record<string, LimitTrack> => {
  const out: Record<string, LimitTrack> = {}
  for (const l of limits) {
    const prev = hist[l.kind]
    const pts = prev && prev.resetsAt === l.resetsAt ? prev.pts : []
    const last = pts[pts.length - 1]
    out[l.kind] = { resetsAt: l.resetsAt, pts: last && last[1] === l.pct ? pts : tail(pts, [at, l.pct] as [number, number], 30) }
  }
  return out
}

// A window that fell to half or less from 20k tokens or more was compacted. This is what counts a compaction when
// the session.compact hook never ran: a managed plugin seated outermost can send that event past this one.
// ponytail: a rewind that drops half the conversation counts too; no event here tells the two apart.
const shrank = (from: number | null | undefined, to: number | null) => from != null && to != null && from >= 20_000 && to <= from / 2

export const withCtx = (b0: Board, ctx: Ctx): Board => {
  const from = b0.ctx?.tokens
  const b = shrank(from, ctx.tokens)
    ? { ...compacted(b0), lastCompact: { at: b0.now, trigger: 'detected', before: from ?? null, after: ctx.tokens, fed: turnFeed(b0, b0.lastCompact?.at ?? b0.startedAt, 5) } }
    : b0
  const last = b.ctxHist[b.ctxHist.length - 1]
  const pct = ctx.pct
  return {
    ...b,
    ctx,
    ctxHist: pct != null && pct !== last ? tail(b.ctxHist, pct, 60) : b.ctxHist,
    limitHist: trackLimits(b.limitHist, ctx.limits, b.now),
  }
}

export const withVitals = (b: Board, v: Vitals, at: number): Board => ({
  ...b,
  vitals: v,
  now: at,
  tempHist: v.tempC !== null ? tail(b.tempHist, v.tempC, 90) : b.tempHist,
})

export const compacted = (b: Board): Board => ({
  ...b,
  compactions: b.compactions + 1,
  alerts: b.alerts.filter(k => !k.startsWith('ctx')),
})

// ---------------------------------------------------------------- analytics

export const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0

export type ToolRow = { tool: string; n: number; okPct: number; avg: number; p95: number; fail: number; denied: number; out: number }

export const toolBoard = (b: Board): ToolRow[] =>
  Object.entries(b.stats)
    .map(([tool, s]) => {
      const sorted = [...s.durs].sort((x, y) => x - y)
      const ran = s.n - s.denied
      return {
        tool,
        n: s.n,
        okPct: s.n ? Math.round((s.ok / s.n) * 100) : 100,
        avg: ran ? Math.round(s.totalMs / ran) : 0,
        p95: pct(sorted, 95),
        fail: s.fail,
        denied: s.denied,
        out: s.out ?? 0,
      }
    })
    .sort((x, y) => y.n - x.n)

// The tools whose results take the most room in the window, heaviest first.
export const ctxWeight = (b: Board): { tool: string; out: number; share: number }[] => {
  const rows = toolBoard(b).filter(r => r.out > 0)
  const total = rows.reduce((s, r) => s + r.out, 0)
  return rows.map(r => ({ tool: r.tool, out: r.out, share: r.out / total })).sort((x, y) => y.out - x.out)
}

export type ModelRow = ModelStat & { model: string; share: number }

export const modelSplit = (b: Board): ModelRow[] => {
  const total = Object.values(b.models).reduce((s, m) => s + m.usd, 0)
  return Object.entries(b.models)
    .map(([model, m]) => ({ model, ...m, share: total > 0 ? m.usd / total : 0 }))
    .sort((x, y) => y.usd - x.usd || y.turns - x.turns)
}

export type Loop = { tool: string; detail: string; n: number; failing: boolean }

// A stuck agent shows as the same call (tool and input) back to back, or the same call failing again and again.
// Read is left out of the back-to-back rule: paging through one large file repeats the path with new offsets.
export const loopWatch = (b: Board): Loop | null => {
  const done = b.calls.filter(c => !c.agent && c.status !== 'run' && c.detail !== '')
  const last = done[done.length - 1]
  if (!last) return null
  let n = 0
  for (let i = done.length - 1; i >= 0 && done[i]?.tool === last.tool && done[i]?.detail === last.detail; i--) n++
  if (n >= 3 && last.tool !== 'Read') return { tool: last.tool, detail: last.detail, n, failing: last.status === 'fail' }
  const fails: Record<string, number> = {}
  for (const c of done.slice(-12)) if (c.status === 'fail') fails[`${c.tool}\u0000${c.detail}`] = (fails[`${c.tool}\u0000${c.detail}`] ?? 0) + 1
  const worst = Object.entries(fails).sort((x, y) => y[1] - x[1])[0]
  if (!worst || worst[1] < 3) return null
  const [tool = '', detail = ''] = worst[0].split('\u0000')
  return { tool, detail, n: worst[1], failing: true }
}

export type FileRow = { path: string; read: number; edit: number; write: number; touches: number; last: number; out: number }

export const fileBoard = (b: Board): FileRow[] =>
  Object.entries(b.files)
    .map(([path, f]) => ({ path, ...f, out: f.out ?? 0, touches: f.read + f.edit + f.write }))
    .sort((x, y) => y.edit + y.write - (x.edit + x.write) || y.touches - x.touches)

// The files whose results (reads, and the snippets edits return) took the most room in the window, heaviest first.
export const fileWeight = (b: Board): FileRow[] => fileBoard(b).filter(f => f.out > 0).sort((x, y) => y.out - x.out)

export const slowest = (b: Board, n = 5): Call[] =>
  b.calls.filter(c => c.ms !== null).sort((x, y) => (y.ms ?? 0) - (x.ms ?? 0)).slice(0, n)

// Context runway: average growth per turn over the last turns that grew, and the turns left before compaction (or a full window).
export const forecast = (b: Board): { burn: number | null; turnsLeft: number | null; ceiling: number } => {
  const ceiling = compactPct(b)
  const grew = b.turns.map(t => t.ctxDelta).filter((d): d is number => d !== null && d > 0).slice(-6)
  const pctNow = b.ctx?.pct
  if (!grew.length || pctNow == null) return { burn: null, turnsLeft: null, ceiling }
  const burn = grew.reduce((s, d) => s + d, 0) / grew.length
  return { burn, turnsLeft: Math.max(0, Math.floor((ceiling - pctNow) / burn)), ceiling }
}

export const costRate = (b: Board): { perHour: number | null; perTurn: number | null; projected: number | null } => {
  const usd = b.ctx?.usd
  if (usd == null) return { perHour: null, perTurn: null, projected: null }
  const hours = Math.max((b.now - b.startedAt) / 3_600_000, 1 / 60)
  const costed = b.turns.filter(t => t.usd !== null)
  const perTurn = costed.length ? costed.reduce((s, t) => s + (t.usd ?? 0), 0) / costed.length : null
  return { perHour: usd / hours, perTurn, projected: perTurn !== null ? usd + perTurn * 10 : null }
}

export type LimitEta = { kind: string; pct: number; etaMs: number | null }

// When each rate-limit window fills at its recent pace: null when it is not filling, the readings span under five
// minutes, or the window resets first.
export const limitEta = (b: Board): LimitEta[] =>
  (b.ctx?.limits ?? []).map(l => {
    const pts = b.limitHist[l.kind]?.pts ?? []
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (!first || !last || last[0] - first[0] < 5 * 60_000 || last[1] <= first[1] || l.pct >= 100) return { kind: l.kind, pct: l.pct, etaMs: null }
    const perMs = (last[1] - first[1]) / (last[0] - first[0])
    const eta = Math.max(0, (100 - last[1]) / perMs - (b.now - last[0]))
    const reset = l.resetsAt ? Date.parse(l.resetsAt) - b.now : Number.NaN
    return { kind: l.kind, pct: l.pct, etaMs: Number.isFinite(reset) && reset > 0 && reset <= eta ? null : eta }
  })

// Turns left before the budget runs out, at the average cost per turn; null with no budget or no costed turns.
export const budgetRunway = (b: Board, cfg: Cfg): number | null => {
  const { perTurn } = costRate(b)
  if (cfg.budgetUsd <= 0 || !perTurn) return null
  return Math.max(0, Math.floor((cfg.budgetUsd - (b.ctx?.usd ?? 0)) / perTurn))
}

// Hours with no toasts. A range that wraps midnight (22-7) counts both sides.
export const isQuiet = (cfg: Cfg, now: number) => {
  if (!cfg.quiet) return false
  const h = new Date(now).getHours()
  const [a, z] = cfg.quiet
  return a < z ? h >= a && h < z : h >= a || h < z
}

// .git/HEAD: "ref: refs/heads/main" on a branch, a bare commit id when detached.
export const parseHead = (text: string | null): string => {
  const t = (text ?? '').trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t)
  if (ref) return ref[1] ?? ''
  return /^[0-9a-f]{7,64}$/.test(t) ? t.slice(0, 7) : ''
}

// In a worktree or submodule .git is a file, "gitdir: <path>", naming the real git directory.
export const gitDirOf = (text: string | null): string | null => /^gitdir:\s*(.+)$/m.exec(text ?? '')?.[1]?.trim() ?? null

// ---------------------------------------------------------------- days

const pad2 = (n: number) => String(n).padStart(2, '0')

// The local calendar date of a timestamp, as YYYY-MM-DD.
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export const addDay = (l: Lifetime, key: string, add: Partial<DayStat>): Lifetime => {
  const days = { ...(l.days ?? {}) }
  const d = days[key] ?? { sessions: 0, usd: 0, turns: 0, calls: 0 }
  days[key] = { sessions: d.sessions + (add.sessions ?? 0), usd: d.usd + (add.usd ?? 0), turns: d.turns + (add.turns ?? 0), calls: d.calls + (add.calls ?? 0) }
  const keep = Object.keys(days).sort().slice(-60)
  return { ...l, days: Object.fromEntries(keep.map(k => [k, days[k] as DayStat])) }
}

// Spend over the last 7 days against the 7 before; change is null when the earlier week spent nothing.
export const weekCompare = (l: Lifetime | null, now: number): { week: number; prior: number; change: number | null } => {
  const d = lastDays(l, now, 14)
  const prior = d.slice(0, 7).reduce((s, x) => s + x.usd, 0)
  const week = d.slice(7).reduce((s, x) => s + x.usd, 0)
  return { week, prior, change: prior > 0 ? (week - prior) / prior : null }
}

// The last `n` calendar days ending on the day of `now`, oldest first; days with no activity read zero.
export const lastDays = (l: Lifetime | null, now: number, n = 30): (DayStat & { key: string })[] => {
  const out: (DayStat & { key: string })[] = []
  const d = new Date(now)
  for (let i = n - 1; i >= 0; i--) {
    const key = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 12).getTime())
    out.push({ key, ...(l?.days?.[key] ?? { sessions: 0, usd: 0, turns: 0, calls: 0 }) })
  }
  return out
}

export const errorRate = (b: Board) => {
  const done = Object.values(b.stats).reduce((s, x) => s + x.n, 0)
  const bad = Object.values(b.stats).reduce((s, x) => s + x.fail, 0)
  return done ? bad / done : 0
}

export type Health = { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; reasons: string[] }

export const health = (b: Board, cfg: Cfg): Health => {
  const reasons: string[] = []
  let score = 100
  const ctxPct = b.ctx?.pct ?? 0
  if (ctxPct > 60) {
    const hit = Math.round(((ctxPct - 60) / 40) * 30)
    score -= hit
    reasons.push(`context ${Math.round(ctxPct)}%`)
  }
  const er = errorRate(b)
  if (er > 0.05) {
    score -= Math.min(25, Math.round(er * 100))
    reasons.push(`${Math.round(er * 100)}% tool errors`)
  }
  const t = b.vitals?.tempC
  if (t != null && t > cfg.maxTempC - 10) {
    score -= t > cfg.maxTempC ? 20 : 10
    reasons.push(`${Math.round(t)}C`)
  }
  if (b.gate.deny > 0) {
    score -= Math.min(10, b.gate.deny * 2)
    reasons.push(`${b.gate.deny} denied`)
  }
  const worst = Math.max(0, ...(b.ctx?.limits ?? []).map(l => l.pct))
  if (worst > 80) {
    score -= 15
    reasons.push(`limit ${worst}%`)
  }
  if (cfg.budgetUsd > 0 && (b.ctx?.usd ?? 0) > cfg.budgetUsd) {
    score -= 10
    reasons.push('over budget')
  }
  const loop = loopWatch(b)
  if (loop) {
    score -= 15
    reasons.push(`looping: ${loop.tool} ×${loop.n}`)
  }
  score = Math.max(0, score)
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F'
  return { score, grade, reasons }
}

export const compliance = (b: Board): number | null => (b.bash.total ? Math.round((b.bash.prefixed / b.bash.total) * 100) : null)

// Threshold crossings worth a toast, each raised once (context ones re-arm after a compaction).
// `today`: what the lifetime store has for today's spend, for the daily budget.
export const newAlerts = (b: Board, cfg: Cfg, today: number | null = null): { key: string; text: string }[] => {
  const out: { key: string; text: string }[] = []
  const add = (key: string, when: boolean, text: string) => {
    if (when && !b.alerts.includes(key)) out.push({ key, text })
  }
  const c = b.ctx?.pct
  add('ctx70', c != null && c >= 70, `Context at ${Math.round(c ?? 0)}%: consider /compact soon`)
  add('ctx85', c != null && c >= 85, `Context at ${Math.round(c ?? 0)}%: compaction is near`)
  const t = steadyTemp(b)
  add('hot', t != null && t > cfg.maxTempC, `Laptop at ${Math.round(t ?? 0)}C: heavy jobs are paused`)
  const usd = b.ctx?.usd ?? 0
  if (cfg.budgetUsd > 0) {
    add('budget50', usd >= cfg.budgetUsd * 0.5, `Session cost $${usd.toFixed(2)}: half of the $${cfg.budgetUsd} budget`)
    add('budget80', usd >= cfg.budgetUsd * 0.8, `Session cost $${usd.toFixed(2)}: 80% of the $${cfg.budgetUsd} budget`)
    add('budget100', usd >= cfg.budgetUsd, `Session cost $${usd.toFixed(2)}: over the $${cfg.budgetUsd} budget`)
  }
  for (const l of b.ctx?.limits ?? []) add(`limit-${l.kind}`, l.pct >= 90, `Rate limit ${l.kind} at ${l.pct}%`)
  const f = forecast(b)
  // A "ctx" key, so it re-arms after a compaction like the other context alerts.
  add('ctx-runway', f.turnsLeft !== null && f.ceiling < 100 && f.turnsLeft <= 2, `Auto-compact in ~${f.turnsLeft} turn${f.turnsLeft === 1 ? '' : 's'}: consider /compact now`)
  for (const e of limitEta(b)) {
    if (e.etaMs !== null) add(`limit-eta-${e.kind}`, e.etaMs <= 30 * 60_000, `Rate limit ${e.kind.replace(/_/g, ' ')} full in ~${dur(e.etaMs)} at this pace`)
  }
  if (cfg.dailyBudgetUsd > 0 && today !== null) {
    const day = dayKey(b.now)
    add(`day80:${day}`, today >= cfg.dailyBudgetUsd * 0.8, `Today's spend $${today.toFixed(2)}: 80% of the $${cfg.dailyBudgetUsd} daily budget`)
    add(`day100:${day}`, today >= cfg.dailyBudgetUsd, `Today's spend $${today.toFixed(2)}: over the $${cfg.dailyBudgetUsd} daily budget`)
  }
  if (cfg.longTurnMin > 0 && b.running && b.now - b.turnStart >= cfg.longTurnMin * 60_000) {
    const lastCall = b.calls.filter(c => !c.agent).slice(-1)[0]
    add(`long:${b.turnCount}`, true, `Turn running ${dur(b.now - b.turnStart)}${lastCall ? ` · last: ${lastCall.tool} ${short(lastCall.detail, 40)}` : ''}`)
  }
  const loop = loopWatch(b)
  if (loop) {
    const what = `${loop.tool} ${short(loop.detail, 40)}`
    add(`loop:${loop.tool}:${loop.detail}`, true, loop.failing ? `${what} failed ${loop.n} times: Claude may be stuck` : `${what} repeated ${loop.n} times in a row: Claude may be looping`)
  }
  if (cfg.cacheAlert) {
    const w = cacheWarmth(b)
    if (w && w.tokens >= 20_000) add(`cache:${b.turnCount}`, w.leftMs > 0 && w.leftMs <= 60_000, `Prompt cache goes cold in ~${dur(w.leftMs)}: a prompt after that writes ~${kfmt(w.tokens)} tokens again`)
  }
  // A job still running two minutes after the turn that left it ended: worth a word, once.
  const ended = b.turns[b.turns.length - 1]?.at ?? 0
  for (const j of openJobs(b)) add(`job:${j.id}`, !b.running && j.at <= ended && b.now - ended >= 120_000, `Background job still running after the turn: ${short(j.cmd, 50)} (${dur(b.now - j.at)})`)
  return out
}

// Wrappers that run the real command after them; skipped so `rtk npm test`, `nice -n 10 cargo build`,
// `timeout 600 npm test` or `bash -c "npm test"` are judged by the command they run.
const WRAPPERS = /^(?:rtk|nice|ionice|time|timeout|sudo|doas|env|npx|pnpx|bunx|command|exec|xargs|nohup|bash|sh|zsh|dash)$/
const SHELLS = /^(?:bash|sh|zsh|dash)$/
// Wrapper flags that take a value: `nice -n 10`, `ionice -c 3`, `sudo -u bob`, `timeout -k 5 60`, `xargs -n 1`.
const VALUE_FLAG = /^-(?:n|c|u|g|k|s|P|I|L)$/
// A duration or count a wrapper takes bare: `timeout 600`, `timeout 10m`.
const BARE_VALUE = /^\d+(?:\.\d+)?[smhd]?$/

// The words after the wrappers that start at `i`: their flags, flag values and bare values skipped. A shell's
// `-c` is followed by the command itself.
const skipWrapper = (words: string[], i: number): number => {
  const shell = SHELLS.test(words[i] ?? '')
  let j = i + 1
  while (j < words.length) {
    const f = words[j] ?? ''
    if (shell && f === '-c') return j + 1
    if (!shell && VALUE_FLAG.test(f)) j += 2
    else if (f.startsWith('-') || BARE_VALUE.test(f)) j++
    else break
  }
  return j
}

// The command words of each part of a shell line (split at &&, ||, ;, | and newlines): leading VAR=value
// assignments, wrappers and their flags dropped, then the first three words, without the quotes or subshell
// parentheses around them. Arguments past those, such as a grep pattern or a commit message, never make a
// command heavy.
export const commandHeads = (command: string): string[] =>
  command
    .split(/&&|\|\||[;|\n]/)
    .map(part => {
      const words = part.trim().replace(/^[("'`$]+/, '').split(/\s+/).filter(Boolean)
      let i = 0
      while (i < words.length) {
        const w = (words[i] ?? '').replace(/^[("'`]+/, '')
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i++
        else if (WRAPPERS.test(w)) {
          words[i] = w
          i = skipWrapper(words, i)
        } else break
      }
      return words
        .slice(i, i + 3)
        .join(' ')
        .replace(/^[("'`]+|[)"'`]+$/g, '')
    })
    .filter(Boolean)

// Tools whose subcommand says what runs (`npm run build`, `cargo test`, `docker compose up`); for anything else only
// the command word counts, so `echo test` or `grep build src/` stay light.
const RUNNERS = /^(?:npm|pnpm|yarn|bun|deno|node|cargo|go|make|docker|podman|prisma|gradle|gradlew|mvn|dotnet|uv|poetry|pip|python3?|claude|turbo|nx)$/

export const isHeavy = (command: string, cfg: Cfg) =>
  commandHeads(command).some(h => {
    const word = h.split(' ')[0] ?? ''
    return cfg.heavy.test(RUNNERS.test(word) ? h : word)
  })

export const refuse = (v: Vitals | null, cfg: Cfg): string | null => {
  if (!cfg.guard || v === null) return null
  if (v.tempC !== null && v.tempC > cfg.maxTempC) return `laptop at ${v.tempC.toFixed(0)}C (limit ${cfg.maxTempC}C)`
  if (v.discharging && v.pct !== null && v.pct < cfg.minBatteryPct) return `battery ${v.pct}% and discharging`
  if (cfg.pauseOnBattery && v.discharging) return 'running on battery'
  if (cfg.maxMemPct > 0 && v.memPct !== null && v.memPct > cfg.maxMemPct) return `memory at ${v.memPct}% (limit ${cfg.maxMemPct}%)`
  return null
}

// Vitals with the temperature steadied: the lower of the last two readings, so one spiky sample (a process
// starting) never holds a job or raises the alarm, while a laptop that stays hot does within one more sample.
export const steadyTemp = (b: Board): number | null => {
  // No reading now means unknown, never an old reading from the history.
  if (b.vitals?.tempC == null) return null
  const last = b.tempHist.slice(-2)
  return last.length ? Math.min(...last) : (b.vitals?.tempC ?? null)
}

export const steadyVitals = (b: Board): Vitals | null => (b.vitals ? { ...b.vitals, tempC: steadyTemp(b) } : null)

// The turn-cost stop: the live turn's spend once it passes `turnBudgetUsd`, else null.
export const turnOver = (b: Board, cfg: Cfg): string | null => {
  if (cfg.turnBudgetUsd <= 0 || !b.running || b.costAtStart === null || b.ctx?.usd == null) return null
  const spent = b.ctx.usd - b.costAtStart
  return spent >= cfg.turnBudgetUsd ? `this turn has cost ${money(spent)} (limit ${money(cfg.turnBudgetUsd)})` : null
}

// The loop breaker: the call about to run would be the third identical one in a row. Read is left out, as in loopWatch.
export const wouldLoop = (b: Board, tool: string, detail: string): boolean => {
  if (tool === 'Read' || detail === '') return false
  const done = b.calls.filter(c => !c.agent && c.status !== 'run')
  const last2 = done.slice(-2)
  return last2.length === 2 && last2.every(c => c.tool === tool && c.detail === detail)
}

// ---------------------------------------------------------------- instruments

// Files read more than once: every read after the first fed the same text again. `waste`: tokens of those repeats.
export const rereads = (b: Board): { rows: (FileRow & { waste: number })[]; waste: number } => {
  const rows = fileBoard(b)
    .filter(f => f.read > 1)
    .map(f => ({ ...f, waste: f.out > 0 ? Math.round((f.out * (f.read - 1)) / f.read) : 0 }))
    .sort((x, y) => y.waste - x.waste || y.read - x.read)
  return { rows, waste: rows.reduce((s, r) => s + r.waste, 0) }
}

// Tools whose latest calls failed back to back (two or more), longest streak first.
export const streaks = (b: Board): { tool: string; n: number; detail: string }[] => {
  const by: Record<string, Call[]> = {}
  for (const c of b.calls) if (!c.agent && c.status !== 'run') (by[c.tool] ??= []).push(c)
  const out: { tool: string; n: number; detail: string }[] = []
  for (const [tool, calls] of Object.entries(by)) {
    let n = 0
    for (let i = calls.length - 1; i >= 0 && calls[i]?.status === 'fail'; i--) n++
    if (n >= 2) out.push({ tool, n, detail: calls[calls.length - 1]?.detail ?? '' })
  }
  return out.sort((x, y) => y.n - x.n)
}

// Why the session costs what it does: the priciest recent turn and what fed it, then plain tips from the numbers.
export const insights = (b: Board, cfg: Cfg): { costly: Turn | null; tips: string[] } => {
  const costly = b.turns.filter(t => t.usd !== null && t.usd > 0).slice(-12).sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0))[0] ?? null
  const tips: string[] = []
  const rr = rereads(b)
  if (rr.waste >= 5000) tips.push(`${rr.rows.length} file${rr.rows.length === 1 ? '' : 's'} read again: ~${kfmt(rr.waste)} tokens repeated. Read ranges, or keep notes`)
  const w = ctxWeight(b)[0]
  if (w && w.share >= 0.5 && w.out >= 5000) tips.push(`${w.tool} results are ${Math.round(w.share * 100)}% of what tools fed back: trim output (head, --quiet, filters)`)
  const hit = cacheHit(b.tokens)
  if (hit !== null && hit < 0.4 && b.turns.length >= 4) tips.push(`cache hit ${Math.round(hit * 100)}%: long gaps between turns let the cache expire`)
  const f = forecast(b)
  if (f.turnsLeft !== null && f.turnsLeft <= 5) tips.push(`~${f.turnsLeft} turns of context left: /compact at a natural break`)
  else if ((b.ctx?.pct ?? 0) >= 70) tips.push(`context ${Math.round(b.ctx?.pct ?? 0)}%: every turn re-reads it; /compact or /clear when switching task`)
  for (const s of streaks(b).slice(0, 1)) tips.push(`${s.tool} failed ${s.n} times in a row: check ${short(s.detail, 40) || 'its input'}`)
  if (cfg.budgetUsd > 0) {
    const left = budgetRunway(b, cfg)
    if (left !== null && left <= 5) tips.push(`~${left} turns of budget left at ${money(costRate(b).perTurn)} a turn`)
  }
  const idle = mcpLoad(b).filter(r => r.calls === 0)
  const idleTokens = idle.reduce((s, r) => s + r.tokens, 0)
  if (idleTokens >= 5000 && b.turnCount >= 3) tips.push(`${idle.length} MCP server${idle.length === 1 ? ' holds' : 's hold'} ~${kfmt(idleTokens)} tokens in every request and went uncalled: switch off what this project does not use (/mcp)`)
  const ch = churn(b)[0]
  if (ch) tips.push(`${shortPath(ch.path, 40)} changed ${ch.edit + ch.write} times: settle the change, then make it in one pass`)
  const sc = sinceCommit(b)
  if (sc && sc.files.length >= 5 && sc.ago >= 30 * 60_000) tips.push(`${sc.files.length} files changed since the last commit ${dur(sc.ago)} ago: commit at a natural break`)
  return { costly, tips }
}

// This session's line in the history, replaced in place while it runs; the last 20 kept.
export const withSession = (l: Lifetime, s: SessionStat): Lifetime => {
  const rest = (l.recent ?? []).filter(x => x.at !== s.at)
  return { ...l, recent: [...rest, s].sort((x, y) => x.at - y.at).slice(-20) }
}

export const sessionStat = (b: Board, cfg: Cfg): SessionStat => ({
  at: b.startedAt,
  ms: Math.max(0, b.now - b.startedAt),
  usd: b.ctx?.usd ?? 0,
  turns: b.turnCount,
  calls: Object.values(b.stats).reduce((s, x) => s + x.n, 0),
  grade: health(b, cfg).grade,
  branch: b.branch,
})

// How long the prompt cache stays warm after the last reply, and the tokens a prompt after that writes again. Null
// while a turn runs or before the first reply.
export const cacheWarmth = (b: Board): { leftMs: number; tokens: number } | null => {
  const last = b.turns[b.turns.length - 1]
  if (b.running || !last) return null
  return { leftMs: Math.max(0, last.at + b.cacheTtl - b.now), tokens: b.ctx?.tokens ?? 0 }
}

export const cacheText = (b: Board): string => {
  const w = cacheWarmth(b)
  if (!w) return ''
  return w.leftMs >= 1000 ? `cache ${dur(w.leftMs)}` : 'cache cold'
}

// An MCP tool's name is mcp__<server>__<tool>; the server part, as tool calls spell it.
const mcpPrefix = (name: string, server: string) =>
  name.startsWith('mcp__') ? `${name.split('__').slice(0, 2).join('__')}__` : `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`

// MCP servers whose tools sit in the window: the tokens they hold in every request, and the calls made to them.
export const mcpLoad = (b: Board): { server: string; tokens: number; calls: number }[] => {
  const by: Record<string, { tokens: number; prefix: string }> = {}
  for (const t of b.comp?.mcp ?? []) {
    if (!t.loaded) continue
    const s = (by[t.server] ??= { tokens: 0, prefix: mcpPrefix(t.name, t.server) })
    s.tokens += t.tokens
  }
  return Object.entries(by)
    .map(([server, s]) => ({
      server,
      tokens: s.tokens,
      calls: Object.entries(b.stats)
        .filter(([tool]) => tool.startsWith(s.prefix))
        .reduce((n, [, x]) => n + x.n, 0),
    }))
    .sort((x, y) => y.tokens - x.tokens)
}

// Each loaded server's run of sessions without a call, counted once per session; a call ends the run.
export const trackMcp = (l: Lifetime, b: Board): Lifetime => {
  const rows = mcpLoad(b)
  if (!rows.length) return l
  const all = { ...(l.mcp ?? {}) }
  for (const r of rows) {
    const s = all[r.server] ?? { idle: 0, session: 0, tokens: 0 }
    const idle = r.calls > 0 ? 0 : s.session === b.startedAt ? s.idle : s.idle + 1
    all[r.server] = { idle, session: b.startedAt, tokens: r.tokens }
  }
  return { ...l, mcp: Object.fromEntries(Object.entries(all).sort((x, y) => y[1].session - x[1].session).slice(0, 40)) }
}

// Loaded servers not called this session, with the sessions in a row they have gone unused.
export const idleMcp = (b: Board, life: Lifetime | null): { server: string; tokens: number; sessions: number }[] =>
  mcpLoad(b)
    .filter(r => r.calls === 0)
    .map(r => ({ server: r.server, tokens: r.tokens, sessions: Math.max(1, life?.mcp?.[r.server]?.idle ?? 1) }))

// ponytail: list prices per million tokens (input, output, cache read, cache write) as published in October 2026.
// They drift: update them here, or read the engine's prices once it exposes them. Haiku 5.5's cache rates are taken
// at the usual 0.1x and 1.25x of input, and it charges 5x for a prompt over 100k tokens.
const ALTERNATIVES: { model: string; skip: RegExp; rates: [number, number, number, number]; over?: [number, number] }[] = [
  { model: 'Sonnet 5.5', skip: /sonnet|haiku/i, rates: [2, 10, 0.2, 2.5] },
  { model: 'Haiku 5.5', skip: /haiku/i, rates: [0.1, 0.5, 0.01, 0.125], over: [100_000, 5] },
]

// The main thread's turns repriced at a cheaper model's list price, against what they cost. Turns that ran a subagent
// are left out: their cost includes tokens this board never sees. Only models cheaper than that are listed.
export const whatIf = (b: Board): { model: string; usd: number; actual: number; turns: number }[] => {
  const turns = b.turns.filter(t => t.tokens && t.usd !== null && !b.agents.some(a => a.startedAt >= t.at - t.ms && a.startedAt <= t.at))
  const actual = turns.reduce((s, t) => s + (t.usd ?? 0), 0)
  if (!turns.length || actual <= 0) return []
  return ALTERNATIVES.filter(a => !a.skip.test(b.model))
    .map(a => ({
      model: a.model,
      usd: turns.reduce((s, t) => {
        const k = t.tokens as Tokens
        const x = a.over && (t.ctxTokens ?? 0) > a.over[0] ? a.over[1] : 1
        return s + ((k.input * a.rates[0] + k.output * a.rates[1] + k.cacheRead * a.rates[2] + k.cacheWrite * a.rates[3]) * x) / 1_000_000
      }, 0),
      actual,
      turns: turns.length,
    }))
    .filter(r => r.usd < actual)
}

// Files changed again and again this session, most first: a sign of trial and error.
export const churn = (b: Board, min = 6): FileRow[] => fileBoard(b).filter(f => f.edit + f.write >= min)

// Files changed this session since the branch last moved (a commit, reset or pull), newest first.
export const sinceCommit = (b: Board): { files: string[]; ago: number } | null => {
  const at = b.commitAt
  if (at === null) return null
  const files = Object.entries(b.files)
    .filter(([, f]) => (f.lastEdit ?? 0) > at)
    .sort((x, y) => (y[1].lastEdit ?? 0) - (x[1].lastEdit ?? 0))
    .map(([path]) => path)
  return { files, ago: Math.max(0, b.now - at) }
}

const TEST_WORD = /(?<![\w./-])(?:test|tests|vitest|jest|pytest|mocha|rspec|phpunit|playwright|e2e)(?![\w./-])/

// A command line that runs tests, judged as the heat guard judges heavy jobs: by the command word, plus the
// subcommand for runners (`npm test`, `cargo test`), so `grep test src` or `cat tests/a.ts` do not count.
export const isTestCommand = (command: string) =>
  commandHeads(command).some(h => {
    const word = h.split(' ')[0] ?? ''
    return TEST_WORD.test(RUNNERS.test(word) ? h : word)
  })

const sum = (s: string, re: RegExp) => [...s.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0)

// Passed and failed counts from a test runner's output (Jest, Vitest, pytest, Mocha, cargo, go test -v, node --test);
// null when it reports none. Jest and Vitest print lines per file and then a "Tests" total: the total wins.
export const parseTests = (text: unknown): { pass: number; fail: number } | null => {
  if (typeof text !== 'string' || !text) return null
  const t = text.slice(-20_000)
  const src = t.split('\n').filter(l => /^\s*Tests\b/.test(l) && /\d+\s+(?:passed|failed)/.test(l)).pop() ?? t
  const pass = sum(src, /(\d+)\s+(?:passed|passing)\b/gi) + sum(src, /^\W*pass\s+(\d+)\s*$/gim) + (src.match(/^\s*--- PASS:/gm)?.length ?? 0)
  const fail = sum(src, /(\d+)\s+(?:failed|failing)\b/gi) + sum(src, /^\W*fail\s+(\d+)\s*$/gim) + (src.match(/^\s*--- FAIL:/gm)?.length ?? 0)
  return pass + fail > 0 ? { pass, fail } : null
}

export const addTest = (b: Board, run: TestRun): Board => ({ ...b, tests: tail(b.tests, run, 20) })

export const startJob = (b: Board, job: Job): Board => ({ ...b, jobs: tail(b.jobs.filter(j => j.id !== job.id), job, 20) })

export const endJob = (b: Board, id: string, status: string, at: number): Board =>
  b.jobs.some(j => j.id === id && j.end === null) ? { ...b, jobs: b.jobs.map(j => (j.id === id && j.end === null ? { ...j, end: at, status } : j)) } : b

export const openJobs = (b: Board) => b.jobs.filter(j => j.end === null)

// ponytail: a background task's end arrives as a notification prompt carrying <task-id> and <status> tags; this reads
// those tags. A job whose notification never comes stays listed as running until /embermeter reset.
export const parseNotice = (text: unknown): { id: string; status: string } | null => {
  if (typeof text !== 'string') return null
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  return id ? { id, status: /<status>\s*([^<\s]+)\s*<\/status>/.exec(text)?.[1] ?? 'ended' } : null
}

// Spend on the session's branch, added turn by turn; the 40 most recently used branches kept.
export const addBranch = (l: Lifetime, branch: string, session: number, usd: number, at: number): Lifetime => {
  if (!branch) return l
  const all = { ...(l.branches ?? {}) }
  const s = all[branch] ?? { usd: 0, turns: 0, sessions: 0, last: 0, session: 0 }
  all[branch] = { usd: s.usd + usd, turns: s.turns + 1, sessions: s.sessions + (s.session === session ? 0 : 1), last: at, session }
  return { ...l, branches: Object.fromEntries(Object.entries(all).sort((x, y) => y[1].last - x[1].last).slice(0, 40)) }
}

export const branchBoard = (l: Lifetime | null): (BranchStat & { branch: string })[] =>
  Object.entries(l?.branches ?? {})
    .map(([branch, s]) => ({ branch, ...s }))
    .sort((x, y) => y.usd - x.usd)

// ---------------------------------------------------------------- formatting

export const short = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export const shortPath = (p: string, n: number) => {
  if (p.length <= n) return p
  const parts = p.split('/')
  let out = parts.pop() ?? p
  while (parts.length && out.length + (parts[parts.length - 1] ?? '').length + 2 <= n) out = `${parts.pop()}/${out}`
  return `…/${out}`.slice(-n)
}

export const dur = (ms: number | null | undefined) => {
  if (ms == null || ms < 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const kfmt = (n: number | null | undefined) =>
  n == null ? '?' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const money = (n: number | null | undefined) => (n == null ? '?' : n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(1)}`)

export const until = (iso: string | null, now: number) => {
  if (!iso) return ''
  const t = Date.parse(iso)
  // A gap past 8 days means `now` is not wall-clock time; show nothing rather than nonsense.
  return Number.isFinite(t) && t > now && t - now < 8 * 86_400_000 ? dur(t - now) : ''
}

export const describe = (e: Record<string, unknown>) =>
  short(e.command ?? e.file_path ?? e.notebook_path ?? e.pattern ?? e.path ?? e.url ?? e.query ?? e.description ?? e.prompt ?? '', 70)

// ---------------------------------------------------------------- report

export const report = (b: Board, cfg: Cfg, life: Lifetime | null): string => {
  const h = health(b, cfg)
  const f = forecast(b)
  const r = costRate(b)
  const rows = toolBoard(b).slice(0, 8)
  const files = fileBoard(b).slice(0, 8)
  const models = modelSplit(b)
  const weight = ctxWeight(b).slice(0, 5)
  const loop = loopWatch(b)
  const left = budgetRunway(b, cfg)
  const month = life ? lastDays(life, b.now, 30) : []
  const monthUsd = month.reduce((s, d) => s + d.usd, 0)
  const week = life ? weekCompare(life, b.now) : null
  const etas = limitEta(b).filter(e => e.etaMs !== null)
  const heavy = fileWeight(b).slice(0, 5)
  const alt = whatIf(b)
  const idle = idleMcp(b, life)
  const lc = b.lastCompact
  const tr = b.tests[b.tests.length - 1]
  const jobs = openJobs(b)
  const sc = sinceCommit(b)
  const branches = branchBoard(life).slice(0, 5)
  const ch = churn(b).slice(0, 3)
  const lines = [
    `# Embermeter session report`,
    ``,
    `- Health: **${h.grade}** (${h.score}/100)${h.reasons.length ? ` · ${h.reasons.join(', ')}` : ''}`,
    `- Duration: ${dur(b.now - b.startedAt)} · ${b.turnCount} turns · ${Object.values(b.stats).reduce((s, x) => s + x.n, 0)} tool calls${b.branch ? ` · on \`${b.branch}\`` : ''}`,
    `- Context: ${kfmt(b.ctx?.tokens)} / ${kfmt(b.ctx?.window)} (${b.ctx?.pct != null ? Math.round(b.ctx.pct) : '?'}%)${f.turnsLeft !== null ? ` · ~${f.turnsLeft} turns of runway` : ''} · ${b.compactions} compactions`,
    `- Cost: ${money(b.ctx?.usd)}${r.perHour !== null ? ` · ${money(r.perHour)}/h` : ''}${r.perTurn !== null ? ` · ${money(r.perTurn)}/turn` : ''}${left !== null ? ` · ~${left} turns of budget left` : ''}`,
    models.length > 1 ? `- Models: ${models.map(m => `${m.model} ${money(m.usd)} (${m.turns} turns)`).join(' · ')}` : '',
    weight.length ? `- Context fed by tools (est.): ${weight.map(w => `${w.tool} ${kfmt(w.out)}`).join(' · ')}` : '',
    heavy.length ? `- Heaviest files (est.): ${heavy.map(f => `${shortPath(f.path, 40)} ${kfmt(f.out)}`).join(' · ')}` : '',
    etas.length ? `- Rate limits at this pace: ${etas.map(e => `${e.kind.replace(/_/g, ' ')} full in ~${dur(e.etaMs)}`).join(' · ')}` : '',
    loop ? `- **Loop warning:** ${loop.tool} \`${short(loop.detail, 50)}\` ${loop.failing ? 'failed' : 'repeated'} ${loop.n} times` : '',
    cacheWarmth(b) ? `- Prompt cache: ${cacheText(b)} left · lasts ${b.cacheTtl === CACHE_LONG ? '1h' : '5m'} after a reply` : '',
    alt.length ? `- Same main-thread tokens at list price: ${alt.map(a => `${a.model} ${money(a.usd)}`).join(' · ')} (paid ${money(alt[0]?.actual)} over ${alt[0]?.turns} turns)` : '',
    idle.length ? `- Loaded MCP servers not called: ${idle.map(r => `${r.server} ${kfmt(r.tokens)}${r.sessions > 1 ? ` (${r.sessions} sessions)` : ''}`).join(' · ')}` : '',
    lc ? `- Last compaction: ${dur(b.now - lc.at)} ago (${lc.trigger})${lc.before !== null && lc.after !== null ? ` · ${kfmt(lc.before)} → ${kfmt(lc.after)} tokens` : ''}${lc.fed.length ? ` · was feeding: ${lc.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ')}` : ''}` : '',
    tr ? `- Tests: last run ${tr.pass} passed, ${tr.fail} failed (\`${short(tr.cmd, 40)}\`)${b.tests.length > 1 ? ` · failing ${b.tests.slice(-5).map(t => t.fail).join(' → ')}` : ''}` : '',
    jobs.length ? `- Background jobs running: ${jobs.map(j => `\`${short(j.cmd, 40)}\``).join(' · ')}` : '',
    sc && sc.files.length ? `- Since the last commit (${dur(sc.ago)} ago): ${sc.files.length} files changed` : '',
    ch.length ? `- Changed again and again: ${ch.map(f => `${shortPath(f.path, 40)} ×${f.edit + f.write}`).join(' · ')}` : '',
    `- Tokens: ${kfmt(b.tokens.input)} in · ${kfmt(b.tokens.output)} out · ${kfmt(b.tokens.cacheRead)} cache read · ${kfmt(b.tokens.cacheWrite)} cache write${cacheHit(b.tokens) !== null ? ` · ${Math.round((cacheHit(b.tokens) ?? 0) * 100)}% cache hit` : ''}${throughput(b) !== null ? ` · ${Math.round(throughput(b) ?? 0)} tok/s` : ''}${b.model ? ` · ${b.model}` : ''}`,
    b.comp ? `- Context mix: ${b.comp.slices.slice().sort((x, y) => y.tokens - x.tokens).slice(0, 5).map(s => `${s.name} ${kfmt(s.tokens)}`).join(' · ')}` : '',
    `- Gate: ${b.gate.allow} allowed · ${b.gate.ask} asked · ${b.gate.deny} denied · ${b.guardBlocks} heat-guard blocks`,
    cfg.prefix && compliance(b) !== null ? `- \`${cfg.prefix}\` prefix compliance: ${compliance(b)}% of ${b.bash.total} commands` : '',
    `- Subagents: ${b.agents.length} (${b.agents.filter(a => a.status === 'done').length} done)${b.agents.some(a => a.tokens) ? ` · ${kfmt(b.agents.reduce((s, a) => s + (a.tokens ?? 0), 0))} tokens` : ''}`,
    rereads(b).rows.length ? `- Read again: ${rereads(b).rows.length} files · ~${kfmt(rereads(b).waste)} tokens repeated` : '',
    streaks(b).length ? `- Failing in a row: ${streaks(b).map(x => `${x.tool} ×${x.n}`).join(' · ')}` : '',
    ...insights(b, cfg).tips.map(t => `- Tip: ${t}`),
    branches.length ? `- By branch (all time): ${branches.map(x => `${x.branch} ${money(x.usd)}`).join(' · ')}` : '',
    life ? `- All time: ${life.sessions} sessions · ${money(life.usd)} · ${life.turns} turns · ${life.calls} tool calls · last 30 days ${money(monthUsd)}${week && week.change !== null ? ` · last 7 days ${money(week.week)} (${week.change >= 0 ? '+' : ''}${Math.round(week.change * 100)}% on the week before)` : ''}` : '',
    ``,
    rows.length ? `| Tool | Calls | OK | Avg | p95 |\n|---|---:|---:|---:|---:|\n${rows.map(t => `| ${t.tool} | ${t.n} | ${t.okPct}% | ${dur(t.avg)} | ${dur(t.p95)} |`).join('\n')}` : '',
    ``,
    files.length ? `| File | Reads | Edits | Writes |\n|---|---:|---:|---:|\n${files.map(x => `| ${shortPath(x.path, 60)} | ${x.read} | ${x.edit} | ${x.write} |`).join('\n')}` : '',
  ]
  return lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n').trim()
}

// ---------------------------------------------------------------- status line

// The status line for the chosen preset; undefined clears it.
export const statusLine = (b: Board, cfg: Cfg): string | undefined => {
  if (cfg.statusLine === 'off') return undefined
  const v = b.vitals
  const c = b.ctx
  const grade = health(b, cfg).grade
  const state = b.running ? `▸ ${dur(b.now - b.turnStart)}` : 'idle'
  const ctx = c?.pct != null ? `ctx ${Math.round(c.pct)}%` : ''
  const parts =
    cfg.statusLine === 'minimal'
      ? [grade, state, ctx]
      : cfg.statusLine === 'cost'
        ? [money(c?.usd), costRate(b).perHour !== null ? `${money(costRate(b).perHour)}/h` : '', cfg.budgetUsd > 0 ? `of ${money(cfg.budgetUsd)}` : '', turnOver(b, cfg) ? 'turn stop' : '', cacheText(b)]
        : [
            grade,
            state,
            ctx,
            c?.usd != null ? money(c.usd) : '',
            v?.tempC != null ? `${Math.round(v.tempC)}°` : '',
            v?.pct != null ? `bat ${v.pct}%${v.discharging ? '↓' : ''}` : '',
            b.agents.some(a => a.status === 'run') ? `${b.agents.filter(a => a.status === 'run').length} agents` : '',
            openJobs(b).length ? `${openJobs(b).length} bg` : '',
            cacheText(b),
          ]
  return parts.filter(p => p && p !== '?').join(' · ') || undefined
}

// ---------------------------------------------------------------- export

// The board as JSON for scripts and spreadsheets: totals, turns, tools, files, agents and the session history.
export const exportJson = (b: Board, cfg: Cfg, life: Lifetime | null): string =>
  JSON.stringify(
    {
      startedAt: new Date(b.startedAt).toISOString(),
      health: health(b, cfg),
      branch: b.branch,
      model: b.model,
      context: b.ctx,
      tokens: b.tokens,
      turns: b.turns.map(t => ({ ...t, at: new Date(t.at).toISOString() })),
      models: modelSplit(b),
      tools: toolBoard(b),
      files: fileBoard(b),
      agents: b.agents,
      gate: b.gate,
      guardBlocks: b.guardBlocks,
      compactions: b.compactions,
      lastCompact: b.lastCompact,
      tests: b.tests,
      jobs: b.jobs,
      whatIf: whatIf(b),
      branches: branchBoard(life),
      history: life?.recent ?? [],
    },
    null,
    2,
  )

// A text cell, quoted when it must be. One a spreadsheet would read as a formula (=, +, -, @, tab, CR) gets a
// leading apostrophe, so a model name or file path can never run as one.
const csvText = (v: string) => {
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

// A number cell, written as is, so a negative context change stays a number.
const csvNum = (v: number | string | null | undefined) => (v == null ? '' : String(v))

// One row per turn, ready for a spreadsheet.
export const turnsCsv = (b: Board): string =>
  [
    'at,ms,usd,tools,ctx_delta_pct,reason,model,input,output,cache_read,cache_write,fed_most',
    ...b.turns.map(t =>
      [
        new Date(t.at).toISOString(),
        csvNum(t.ms),
        csvNum(t.usd?.toFixed(4)),
        csvNum(t.tools),
        csvNum(t.ctxDelta?.toFixed(1)),
        csvText(t.reason),
        csvText(t.model),
        csvNum(t.tokens?.input),
        csvNum(t.tokens?.output),
        csvNum(t.tokens?.cacheRead),
        csvNum(t.tokens?.cacheWrite),
        csvText(t.fed?.[0] ? `${t.fed[0].name} ${t.fed[0].out}` : ''),
      ].join(','),
    ),
  ].join('\n')
