export type Vitals = {
  tempC: number | null
  pct: number | null
  discharging: boolean
  load1: number | null
  memPct: number | null
}

export type Limit = { kind: string; pct: number; resetsAt: string | null }

export type Ctx = {
  tokens: number | null
  window: number | null
  pct: number | null
  usd: number | null
  limits: Limit[]
}

export type CallStatus = 'run' | 'ok' | 'denied' | 'fail'

export type Call = {
  id: string
  tool: string
  detail: string
  // The file a Read, Edit or Write worked on, so its result size can be credited to that file.
  file?: string
  status: CallStatus
  agent: boolean
  at: number
  ms: number | null
  // Estimated tokens the result fed back into the context, once finished.
  out?: number
}

// `out`: estimated tokens the tool's results fed back into the context (absent on boards stored before it existed).
export type ToolStat = { n: number; ok: number; fail: number; denied: number; totalMs: number; durs: number[]; out?: number }

// `out`: estimated tokens this file's reads fed back into the context. `lastEdit`: when an Edit or Write last touched it.
export type FileStat = { read: number; edit: number; write: number; last: number; out?: number; lastEdit?: number }

// Readings of one rate-limit window, kept while the window stays the same (same reset time).
export type LimitTrack = { resetsAt: string | null; pts: [number, number][] }

export type AgentStatus = 'run' | 'done' | 'fail' | 'stopped'

export type Agent = {
  id: string
  type: string
  desc: string
  model: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  tools: number
  // Tokens this subagent's turns reported (input, cache and output), when the engine gave usage.
  tokens?: number
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Turn = {
  at: number
  ms: number
  usd: number | null
  tools: number
  ctxDelta: number | null
  reason: string
  model: string
  tokens: Tokens | null
  // What fed this turn's context most: files or tools, by estimated tokens, heaviest first.
  fed?: { name: string; out: number }[]
  // Tokens in the window when the turn ended: the prompt size its requests resent.
  ctxTokens?: number | null
}

// One compaction of the main conversation: what it shrank, and what had been feeding the window before it.
export type CompactSnap = { at: number; trigger: string; before: number | null; after: number | null; fed: { name: string; out: number }[] }

// One test command's result, as counted from its output.
export type TestRun = { at: number; cmd: string; pass: number; fail: number }

// A Bash command run in the background. `end` stays null until it is stopped or its notification says it ended.
export type Job = { id: string; cmd: string; at: number; end: number | null; status: string }

export type Slice = { name: string; tokens: number; kind: string }

export type Composition = {
  model: string
  total: number
  max: number
  compactAt: number | null
  autoCompact: boolean
  slices: Slice[]
  memory: { path: string; tokens: number }[]
  mcp: { name: string; server: string; tokens: number; loaded: boolean }[]
  at: number
}

export type ModelStat = { turns: number; usd: number; input: number; output: number }

export type LogKind ='info' | 'done' | 'warn' | 'error'

export type LogLine = { at: number; who: string; text: string; kind: LogKind }

export type Board = {
  startedAt: number
  now: number
  vitals: Vitals | null
  ctx: Ctx | null
  comp: Composition | null
  tokens: Tokens
  model: string
  running: boolean
  turnStart: number
  turnTools: number
  turnCtxStart: number | null
  costAtStart: number | null
  turns: Turn[]
  turnCount: number
  models: Record<string, ModelStat>
  limitHist: Record<string, LimitTrack>
  branch: string
  calls: Call[]
  stats: Record<string, ToolStat>
  files: Record<string, FileStat>
  bash: { total: number; prefixed: number }
  gate: { allow: number; ask: number; deny: number }
  agents: Agent[]
  log: LogLine[]
  ctxHist: number[]
  tempHist: number[]
  activity: number[]
  activityMinute: number
  compactions: number
  guardBlocks: number
  alerts: string[]
  // How long the prompt cache stays warm after a reply: 5 minutes, or an hour once a cache read is seen after a longer gap.
  cacheTtl: number
  lastCompact: CompactSnap | null
  tests: TestRun[]
  jobs: Job[]
  // When the current branch last moved (a commit, reset or pull), from git's own files; null when unknown.
  commitAt: number | null
}

export type Tab = 'overview' | 'context' | 'spend' | 'tools' | 'files' | 'agents' | 'system' | 'log'

export type DayStat = { sessions: number; usd: number; turns: number; calls: number }

// One past session, keyed by when it started.
export type SessionStat = { at: number; ms: number; usd: number; turns: number; calls: number; grade: string; branch: string }

// Spend on one git branch across sessions. `session`: when the last session counted began, so each counts once.
export type BranchStat = { usd: number; turns: number; sessions: number; last: number; session: number }

// One MCP server's tools in the window: sessions in a row it was loaded and never called, and the tokens it last held.
export type McpStat = { idle: number; session: number; tokens: number }

// `days`: totals per local date (YYYY-MM-DD), the most recent 60 kept. `recent`: the last 20 sessions, newest last.
// `branches`: spend per git branch, the 40 most recent. `mcp`: MCP servers by name, the 40 most recent.
export type Lifetime = {
  sessions: number
  usd: number
  turns: number
  calls: number
  days?: Record<string, DayStat>
  recent?: SessionStat[]
  branches?: Record<string, BranchStat>
  mcp?: Record<string, McpStat>
}

declare module 'claude-code' {
  interface PluginState {
    embermeter: { board: Board; tab: Tab }
  }
}
