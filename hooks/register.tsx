import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Agent, Board, Call, CallStatus, Ctx, Lifetime, Tab, Vitals } from '../types'
import {
  addDay,
  compacted,
  countCpus,
  dayKey,
  describe,
  dur,
  emptyBoard,
  endAgent,
  endTurn,
  estTokens,
  isHeavy,
  finishCall,
  gitDirOf,
  health,
  isQuiet,
  kfmt,
  log,
  money,
  newAlerts,
  normalize,
  parseConfig,
  parseHead,
  pickTemp,
  refuse,
  report,
  short,
  shortPath,
  slowest,
  spawnAgent,
  startCall,
  startTurn,
  toComposition,
  steadyVitals,
  withCtx,
  withVitals,
} from './core'
import type { Cfg } from './core'
import { agents as drawAgents, card, contextPage, drawContext, files as drawFiles, header, overview, spend, strip, system, tools as drawTools } from './draw'
import type { Line } from './text'
import { textHeader, textPage, textStrip } from './text'

const PANE = 'embermeter'
const TABS: { id: Tab; label: string; key: string }[] = [
  { id: 'overview', label: 'Overview', key: '1' },
  { id: 'context', label: 'Context', key: '2' },
  { id: 'spend', label: 'Spend', key: '3' },
  { id: 'tools', label: 'Tools', key: '4' },
  { id: 'files', label: 'Files', key: '5' },
  { id: 'agents', label: 'Agents', key: '6' },
  { id: 'system', label: 'System', key: '7' },
  { id: 'log', label: 'Log', key: '8' },
]

const boardAtom = atom({ plugin: 'embermeter', key: 'board' } as const, emptyBoard())
const tabAtom = atom({ plugin: 'embermeter', key: 'tab' } as const, 'overview')

let cfg: Cfg = parseConfig()
let life: Lifetime | null = null
let ticks = 0
let compAt = 0
// The board each site drew last, so a changed value eases from where it was.
const drawn: Record<string, Board> = {}

// ---------------------------------------------------------------- state access

const get = async ($: any): Promise<Board> => normalize(await read($, boardAtom))

const set = ($: any, fn: (b: Board) => Board) => update($, boardAtom, (b: Board) => fn(normalize(b)))

const note = async ($: any, who: string, text: string, kind: 'info' | 'done' | 'warn' | 'error' = 'info') => {
  const at = await $.clock.now()
  await set($, b => log(b, at, who, text, kind))
}

const setTab = async ($: any, tab: Tab) => {
  await update($, tabAtom, () => tab)
  if (tab === 'context') await refreshComp($, true)
}

// ---------------------------------------------------------------- sensing

// ponytail: Linux /sys and /proc only; elsewhere the machine gauges read "–" and the heat guard stays off.
const readText = async ($: any, path: string): Promise<string | null> => {
  try {
    return (await $.fs.read(path)).trim()
  } catch {
    return null
  }
}

const readNum = async ($: any, path: string) => {
  const n = Number.parseInt((await readText($, path)) ?? '', 10)
  return Number.isFinite(n) ? n : null
}

const ZONES = Array.from({ length: 16 }, (_, i) => `/sys/class/thermal/thermal_zone${i}`)

const sampleVitals = async ($: any): Promise<Vitals> => {
  const zones = await Promise.all(ZONES.map(async z => ({ type: (await readText($, `${z}/type`)) ?? '', milli: await readNum($, `${z}/temp`) })))
  if (!cfg.threads) cfg = { ...cfg, threads: countCpus(await readText($, '/sys/devices/system/cpu/online')) ?? 8 }
  const loadTxt = await readText($, '/proc/loadavg')
  const mem = (await readText($, '/proc/meminfo')) ?? ''
  const total = Number(/MemTotal:\s+(\d+)/.exec(mem)?.[1])
  const avail = Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1])
  return {
    tempC: pickTemp(zones),
    pct: await readNum($, '/sys/class/power_supply/BAT0/capacity'),
    discharging: (await readText($, '/sys/class/power_supply/BAT0/status')) === 'Discharging',
    load1: loadTxt ? Number.parseFloat(loadTxt) : null,
    memPct: total > 0 && avail >= 0 ? Math.round(((total - avail) / total) * 100) : null,
  }
}

const sampleCtx = async ($: any): Promise<Ctx | null> => {
  const u = await $.session.usage().catch(() => null)
  if (!u) return null
  return {
    tokens: u.context?.tokens ?? null,
    window: u.context?.window ?? null,
    pct: u.context?.percent ?? null,
    usd: u.cost?.usd ?? null,
    limits: (u.rateLimits ?? []).map((r: any) => ({ kind: String(r.kind), pct: Math.round(r.percentUsed), resetsAt: r.resetsAt ?? null })),
  }
}

// The /context breakdown, estimated locally ("summary" sends no request); at most every 15 seconds unless forced.
const refreshComp = async ($: any, force = false) => {
  const now = await $.clock.now()
  if (!force && now - compAt < 15_000) return
  compAt = now
  const u = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const comp = toComposition(u?.context?.breakdown, now)
  if (comp) await set($, b => ({ ...b, comp, model: b.model || comp.model }))
  await refreshBranch($)
}

// The git branch, from .git/HEAD under the project root (read-only; no git process). In a worktree .git is a
// file naming the real git directory.
const refreshBranch = async ($: any) => {
  const root = await $.session.root().catch(() => null)
  if (!root) return
  let head = await readText($, `${root}/.git/HEAD`)
  if (head === null) {
    const dir = gitDirOf(await readText($, `${root}/.git`))
    if (dir) head = await readText($, `${dir.startsWith('/') ? dir : `${root}/${dir}`}/HEAD`)
  }
  const branch = parseHead(head)
  if (branch !== (await get($)).branch) await set($, b => ({ ...b, branch }))
}

// ---------------------------------------------------------------- side effects

const statusText = (b: Board) => {
  const v = b.vitals
  const c = b.ctx
  const live = b.agents.filter(a => a.status === 'run').length
  return [
    health(b, cfg).grade,
    b.running ? `▸ ${dur(b.now - b.turnStart)}` : 'idle',
    c?.pct != null ? `ctx ${Math.round(c.pct)}%` : '',
    c?.usd != null ? money(c.usd) : '',
    v?.tempC != null ? `${Math.round(v.tempC)}°` : '',
    v?.pct != null ? `bat ${v.pct}%${v.discharging ? '↓' : ''}` : '',
    live ? `${live} agents` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

const raise = async ($: any) => {
  const b = await get($)
  const fresh = newAlerts(b, cfg, life?.days?.[dayKey(b.now)]?.usd ?? null)
  if (!fresh.length) return
  const at = await $.clock.now()
  await set($, x => fresh.reduce((acc, a) => log({ ...acc, alerts: [...acc.alerts, a.key] }, at, 'alert', a.text, 'warn'), x))
  // Quiet hours hold the toasts only; the alert is still logged and shown in the pane.
  if (cfg.alerts && !isQuiet(cfg, at)) for (const a of fresh) $.ui.toast(`Embermeter · ${a.text}`)
}

// One timer drives the dashboard: clocks every second while work runs, sensors every 5th second.
const tick = async ($: any) => {
  ticks += 1
  const b = await get($)
  const busy = b.running || b.agents.some(a => a.status === 'run')
  if (ticks % 5 === 0 || b.vitals === null) {
    const [vitals, ctx, now] = await Promise.all([sampleVitals($), sampleCtx($), $.clock.now()])
    await set($, x => {
      const withV = withVitals(x, vitals, now)
      return ctx ? withCtx(withV, ctx) : withV
    })
    if (busy || b.comp === null) await refreshComp($)
    await raise($)
  } else if (busy) {
    const now = await $.clock.now()
    await set($, x => ({ ...x, now }))
  } else {
    return
  }
  $.ui.status(statusText(await get($)) || undefined)
}

const saveLife = async ($: any, fn: (l: Lifetime) => Lifetime) => {
  const base: Lifetime = { sessions: 0, usd: 0, turns: 0, calls: 0, ...((await $.store.get('lifetime').catch(() => null)) ?? {}) }
  life = fn(base)
  await $.store.set('lifetime', life).catch(() => undefined)
}

const copyReport = async ($: any, surface?: any) => {
  await $.ui.copy({ text: report(await get($), cfg, life), surface })
  $.ui.toast('Embermeter report copied')
}

const copyCard = async ($: any, surface?: any) => {
  await $.ui.copy({ text: card(drawContext(cfg, null, undefined), await get($), cfg), surface })
  $.ui.toast('Embermeter session card copied as SVG')
}

const resetBoard = async ($: any) => {
  const now = await $.clock.now()
  await set($, () => emptyBoard(now))
  await tick($)
}

// The terminal has no Svg, yet resolve still hands one back that draws nothing; go by the surface.
const vector = (e: any) => e.surface !== 'terminal'

const openPane = async ($: any) => $.ui.open({ id: PANE, title: 'Embermeter', columns: 82 })

// ---------------------------------------------------------------- the mod

export const register: Register = (on, options) => {
  cfg = parseConfig(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'embermeter',
      description: 'Embermeter dashboard: open, close, report, copy, card, reset, or a tab (overview context spend tools files agents system log)',
      argumentHint: '[open|close|report|copy|card|reset|<tab>]',
    })
    const fresh = (await get($)).startedAt === 0
    if (fresh) {
      const u = await $.session.usage().catch(() => null)
      const start = u?.startedAt ?? (await $.clock.now())
      await set($, () => emptyBoard(start))
      await saveLife($, l => addDay({ ...l, sessions: l.sessions + 1 }, dayKey(start), { sessions: 1 }))
    } else {
      await saveLife($, l => l)
    }
    // Unasked, a terminal seats the pane only from 144 columns; say how to open it rather than show nothing.
    if (cfg.openOnStart)
      void openPane($).then((o: any) => {
        if (!o?.isPlaced) $.ui.toast('Embermeter: terminal too narrow to dock the pane on start; /embermeter opens it')
      })
    await tick($)
    await refreshComp($, true)
    $.clock.every(1000, () => tick($))
    return next(e)
  })

  on('command.run', { command: 'embermeter' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'report') return { text: report(await get($), cfg, life) }
    if (arg === 'card') {
      await copyCard($)
      return { text: 'Embermeter session card copied to the clipboard as SVG. Paste it into a .svg file to share it.' }
    }
    if (arg === 'copy') {
      await copyReport($)
      return { text: 'Embermeter report copied to the clipboard.' }
    }
    if (arg === 'reset') {
      await resetBoard($)
      return { text: 'Embermeter counters reset.' }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Embermeter closed.' }
    }
    const tab = TABS.find(t => t.id === arg)
    if (tab) await setTab($, tab.id)
    const opened = await openPane($)
    return {
      text: opened.isPlaced
        ? `Embermeter open${tab ? ` on ${tab.label}` : ''}.`
        : 'No surface can seat a pane here; the strip above the prompt and the status line carry the live data. Try /embermeter report.',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    await note($, 'you', (e as any).text ?? '')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const [now, ctx] = await Promise.all([$.clock.now(), sampleCtx($)])
    await set($, b => startTurn(b, now, ctx))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const now = await $.clock.now()
    const ms = (e as any).durationMs ?? null
    if (e.agentId === undefined) {
      const ctx = await sampleCtx($)
      await set($, b => endTurn(ctx ? withCtx(b, ctx) : b, now, ms, e.reason, ctx, (e as any).usage ?? null))
      const b = await get($)
      const t = b.turns[b.turns.length - 1]
      const tok = t?.tokens ? ` · ${kfmt(t.tokens.output)} out` : ''
      await note($, 'main', `${e.reason} · ${dur(t?.ms)} · ${t?.tools ?? 0} tools${tok}${t?.usd != null ? ` · ${money(t.usd)}` : ''}`, e.reason === 'answer' ? 'done' : 'error')
      const add = { turns: 1, calls: t?.tools ?? 0, usd: t?.usd ?? 0 }
      await saveLife($, l => addDay({ ...l, turns: l.turns + add.turns, calls: l.calls + add.calls, usd: l.usd + add.usd }, dayKey(now), add))
      await refreshComp($, true)
      await raise($)
    } else {
      const id = e.agentId
      await set($, b => endAgent({ ...b, now }, id, e.reason, now, (e as any).usage ?? null))
      const a = (await get($)).agents.find(x => x.id === id)
      if (a) await note($, a.type, `${a.status} · ${dur((a.endedAt ?? now) - a.startedAt)} · ${a.tools} tools`, a.status === 'done' ? 'done' : 'error')
    }
    $.ui.status(statusText(await get($)) || undefined)
    return done
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const ctx = await sampleCtx($)
    if (ctx) await set($, b => withCtx(b, ctx))
    await raise($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    await set($, compacted)
    await note($, 'context', 'compacted', 'warn')
    await refreshComp($, true)
    return out
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const key = verdict.decision === 'deny' ? 'deny' : verdict.decision === 'ask' ? 'ask' : 'allow'
    await set($, b => ({ ...b, gate: { ...b.gate, [key]: b.gate[key] + 1 } }))
    if (key === 'deny') await note($, 'gate', `denied ${e.tool} ${describe(((e as any).input ?? {}) as Record<string, unknown>)}`, 'error')
    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const input = e as any
    const at = await $.clock.now()
    const call: Call = { id: e.tool_use_id, tool: String(e.tool), detail: describe(input), status: 'run', agent: Boolean(input.agentId), at, ms: null }
    const file = input.file_path ?? input.notebook_path
    await set($, b =>
      startCall(b, call, { file: typeof file === 'string' ? file : undefined, command: typeof input.command === 'string' ? input.command : undefined, agentId: input.agentId }, cfg.prefix),
    )
    const ran = await next(e)
    const status: CallStatus = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'fail' : 'ok'
    const end = await $.clock.now()
    await set($, b => finishCall(b, call.id, status, end - at, estTokens((ran as any).text)))
    if (status === 'fail') await note($, call.tool, `failed · ${call.detail}`, 'error')
    return ran
  }).catch(($, e, next) => next(e)) // fail open: a dashboard fault never blocks a tool

  on('agent.spawn', async ($, e, next) => {
    const started: any = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const at = await $.clock.now()
    const agent: Agent = {
      id: started.agentId,
      type: String((e as any).name ?? e.subagentType ?? 'agent'),
      desc: String(e.description ?? ''),
      model: String(started.model ?? ''),
      status: 'run',
      startedAt: at,
      endedAt: null,
      tools: 0,
    }
    await set($, b => spawnAgent(b, agent))
    await note($, agent.type, `spawned · ${short(agent.desc, 70)}`)
    return started
  }).catch(($, e, next) => next(e))

  // Heat guard: heavy Bash jobs wait while the laptop is hot or low on battery. A guard fault lets the call through.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!cfg.guard || !isHeavy(e.command, cfg)) return next(e)
    const why = refuse(steadyVitals(await get($)), cfg)
    if (!why) return next(e)
    await set($, b => ({ ...b, guardBlocks: b.guardBlocks + 1 }))
    await note($, 'guard', `held · ${short(e.command, 60)} · ${why}`, 'error')
    $.ui.toast(`Embermeter · heavy job held, ${why}`)
    return { deny: `${$.plugin.name}: heavy job blocked, ${why}. Wait or ask the user before retrying.` }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!cfg.band || (e as any).props?.hasSurvey) return next(e)
    const b = await get($)
    if (b.vitals === null) return next(e)
    const { Box, Text, Svg } = $.ui.resolve(e) as any
    if (!vector(e)) {
      const l = textStrip(b, cfg)
      return (
        <Box>
          <Text {...(l.c ? { color: l.c } : {})}>{l.t}</Text>
        </Box>
      )
    }
    const D = drawContext(cfg, drawn.band ?? null, undefined)
    drawn.band = b
    return (
      <Box>
        <Svg source={strip(D, b, cfg)} alt={`Embermeter: ${statusText(b)}`} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Svg: SvgEl, Button } = $.ui.resolve(e) as any
    const Svg = vector(e) ? SvgEl : undefined
    const b = await get($)
    const tab = ((await read($, tabAtom)) ?? 'overview') as Tab
    const cols: number | undefined = (e as any).props?.bodyColumns
    const rows = Math.max(6, Math.floor(((e as any).viewport?.rows ?? 40) / 3))
    const site = `pane:${tab}`
    const D = drawContext(cfg, drawn[site] ?? null, cols)
    drawn[site] = b
    const warn = refuse(steadyVitals(b), cfg)

    // Surfaces without Svg (the terminal) get the same data as text lines.
    const lines = (ls: Line[]) => (
      <Box flexDirection="column">
        {ls.map(l => (
          <Text {...(l.c ? { color: l.c } : {})} {...(l.b ? { bold: true } : {})}>
            {l.t}
          </Text>
        ))}
      </Box>
    )
    const picture = (source: string, alt: string) => <Svg source={source} alt={alt} />

    // Each tab's picture, drawn only for the tab on show; the log tab is text alone.
    const pages: Partial<Record<Tab, () => any>> = {
      overview: () => picture(overview(D, b, cfg), `Overview · ${statusText(b)}`),
      context: () => picture(contextPage(D, b), `Context · ${kfmt(b.ctx?.tokens)} of ${kfmt(b.ctx?.window)}`),
      spend: () => picture(spend(D, b, cfg, life), `Spend · ${money(b.ctx?.usd)} this session`),
      tools: () => picture(drawTools(D, b), 'Tool leaderboard'),
      files: () => picture(drawFiles(D, b), 'File heatmap'),
      agents: () => picture(drawAgents(D, b), 'Subagent swimlanes'),
      system: () => picture(system(D, b, cfg), 'Machine vitals and guardrails'),
    }
    const page = Svg ? (pages[tab]?.() ?? null) : tab === 'log' ? null : lines(textPage(tab, b, cfg, life, cols))

    return (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          {TABS.map(t => (
            <Button key={`tab-${t.id}`} hotkey={t.key} dimColor={t.id !== tab} onPress={() => setTab($, t.id)}>
              {t.id === tab ? `▸ ${t.label}` : t.label}
            </Button>
          ))}
          <Button key="copy" plain onPress={(press: any) => copyReport($, press?.surface)}>
            Copy report
          </Button>
          <Button key="card" plain onPress={(press: any) => copyCard($, press?.surface)}>
            Copy card
          </Button>
          <Button key="reset" plain onPress={() => resetBoard($)}>
            Reset
          </Button>
        </Box>
        {Svg ? picture(header(D, b, cfg), `Embermeter · ${statusText(b)}`) : lines(textHeader(b, cfg))}
        {warn && (
          <Text color="error" bold>
            Heat guard armed: {warn}. Heavy jobs wait.
          </Text>
        )}
        {page}

        {tab === 'tools' && (
          <Box flexDirection="column">
            <Text bold>Slowest calls</Text>
            {slowest(b, 6).map(c => (
              <Text color="subtle">
                {dur(c.ms).padStart(6)} · {c.tool} · {c.detail}
              </Text>
            ))}
            <Text bold>Recent</Text>
            {b.calls
              .slice(-rows)
              .reverse()
              .map(c => (
                <Text color={c.status === 'fail' || c.status === 'denied' ? 'error' : c.status === 'run' ? 'warning' : 'subtle'}>
                  {c.status === 'run' ? '▸' : c.status === 'ok' ? '✓' : c.status === 'denied' ? '⊘' : '✕'} {c.agent ? '[agent] ' : ''}
                  {c.tool} {c.detail} {c.ms !== null ? `· ${dur(c.ms)}` : ''}
                </Text>
              ))}
          </Box>
        )}

        {tab === 'files' && (
          <Box flexDirection="column">
            <Text bold>Most recent</Text>
            {Object.entries(b.files)
              .sort((x, y) => y[1].last - x[1].last)
              .slice(0, rows)
              .map(([path, f]) => (
                <Text color={f.edit + f.write === 0 ? 'subtle' : undefined}>
                  {shortPath(path, 70)} · {f.edit} edit · {f.write} write · {f.read} read
                </Text>
              ))}
          </Box>
        )}

        {tab === 'agents' && (
          <Box flexDirection="column">
            <Text bold>Open a transcript</Text>
            {b.agents
              .slice(-12)
              .reverse()
              .map(a => (
                <Button key={`agent-${a.id}`} plain onPress={() => $.ui.view({ agentId: a.id })}>
                  {a.status === 'run' ? '▸' : a.status === 'done' ? '✓' : '✕'} {a.type}
                  {a.model ? ` · ${a.model}` : ''} · {short(a.desc, 60)}
                </Button>
              ))}
          </Box>
        )}

        {tab === 'log' && (
          <Box flexDirection="column">
            {b.log.length === 0 && <Text color="subtle">Nothing logged yet.</Text>}
            {b.log
              .slice(-rows * 2)
              .reverse()
              .map(l => (
                <Text color={l.kind === 'error' ? 'error' : l.kind === 'warn' ? 'warning' : l.kind === 'done' ? 'success' : 'subtle'}>
                  {dur(b.now - l.at).padStart(6)} · {l.who}: {l.text}
                </Text>
              ))}
          </Box>
        )}

        {life && (
          <Text color="subtle">
            All time · {life.sessions} sessions · {money(life.usd)} · {life.turns} turns · {life.calls} tool calls · today {money(life.days?.[dayKey(b.now)]?.usd ?? 0)}
          </Text>
        )}
      </Box>
    )
  })
}
