// Text drawing for surfaces without Svg (the terminal): the same numbers as draw.ts, as lines of
// bars, sparklines and columns. Pure, no `$`.
import type { Board, Lifetime, Tab } from '../types'
import type { Cfg } from './core'
import {
  budgetRunway,
  cacheHit,
  compactPct,
  compliance,
  costRate,
  ctxWeight,
  dur,
  fileBoard,
  fileWeight,
  forecast,
  health,
  kfmt,
  lastDays,
  limitEta,
  modelSplit,
  money,
  short,
  shortPath,
  throughput,
  toolBoard,
  until,
  weekCompare,
} from './core'

export type Line = { t: string; c?: 'error' | 'warning' | 'success' | 'subtle'; b?: boolean }

const clamp = (f: number) => Math.max(0, Math.min(1, f))

// A meter `w` cells wide: filled blocks, then shade.
export const bar = (f: number | null, w: number) => {
  if (f === null || !Number.isFinite(f)) return '░'.repeat(w)
  const n = Math.round(clamp(f) * w)
  return '█'.repeat(n) + '░'.repeat(w - n)
}

const TICKS = '▁▂▃▄▅▆▇█'

// The last `w` values as one row of block heights, scaled to `max` (or the largest value).
export const spark = (values: number[], w: number, max?: number) => {
  const vs = values.slice(-w)
  if (!vs.length) return '–'
  const top = Math.max(max ?? 0, ...vs, 1e-9)
  return vs.map(v => TICKS[Math.min(7, Math.max(0, Math.round((v / top) * 7)))]).join('')
}

const lvl = (f: number | null): Line['c'] => (f === null ? 'subtle' : f >= 0.85 ? 'error' : f >= 0.65 ? 'warning' : undefined)

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

// One gauge row: label, meter, value, note.
const gauge = (W: number, label: string, f: number | null, value: string, note = '', c?: Line['c']): Line => ({
  t: `${pad(label, 11)} ${bar(f, Math.max(8, W - 36))} ${lpad(value, 6)}  ${short(note, 14)}`,
  c: c ?? lvl(f),
})

const title = (t: string, note = ''): Line => ({ t: note ? `${t} · ${note}` : t, b: true })
const gap: Line = { t: ' ' }

export const textHeader = (b: Board, cfg: Cfg): Line[] => {
  const h = health(b, cfg)
  const busy = b.running || b.agents.some(a => a.status === 'run')
  const state = b.running ? `▸ running ${dur(b.now - b.turnStart)}` : busy ? '▸ agents working' : 'idle'
  return [
    { t: `[${h.grade}] ${h.score}/100 · ${h.reasons.length ? h.reasons.slice(0, 3).join(' · ') : 'all clear'}`, b: true, c: h.grade === 'A' ? 'success' : h.grade === 'B' ? undefined : h.grade === 'C' ? 'warning' : 'error' },
    { t: [state, `turn ${b.turnCount}`, dur(b.now - b.startedAt), b.branch ? `on ${short(b.branch, 20)}` : '', b.model ? short(b.model, 28) : ''].filter(Boolean).join(' · '), c: busy ? 'warning' : 'subtle' },
  ]
}

const limits = (b: Board, W: number): Line[] => {
  const ls = b.ctx?.limits ?? []
  if (!ls.length) return []
  const etas = limitEta(b)
  return [
    gap,
    title('Rate limits', 'resets in · or fills in, at this pace'),
    ...ls.map(l => {
      const eta = etas.find(e => e.kind === l.kind)?.etaMs ?? null
      return gauge(W, l.kind.replace(/_/g, ' '), l.pct / 100, `${l.pct}%`, eta !== null ? `full ~${dur(eta)}` : until(l.resetsAt, b.now) || '–', eta !== null ? 'error' : undefined)
    }),
  ]
}

const overview = (b: Board, cfg: Cfg, W: number): Line[] => {
  const c = b.ctx
  const v = b.vitals
  const f = forecast(b)
  const r = costRate(b)
  const hit = cacheHit(b.tokens)
  const tp = throughput(b)
  const sw = Math.max(10, W - 24)
  const turns = b.turns.slice(-sw)
  return [
    title('Vitals', f.turnsLeft !== null ? `~${f.turnsLeft} turns to ${f.ceiling < 100 ? 'compaction' : 'full'}` : ''),
    gauge(W, 'Context', c?.pct != null ? c.pct / f.ceiling : null, c?.pct != null ? `${Math.round(c.pct)}%` : '–', `${kfmt(c?.tokens)}/${kfmt(c?.window)}`),
    gauge(
      W,
      cfg.budgetUsd > 0 ? `Cost/$${cfg.budgetUsd}` : 'Cost',
      c?.usd != null ? (cfg.budgetUsd > 0 ? c.usd / cfg.budgetUsd : c.usd / 10) : null,
      money(c?.usd),
      r.perHour !== null ? `${money(r.perHour)}/h` : '',
      cfg.budgetUsd > 0 ? undefined : 'subtle',
    ),
    gauge(W, 'Cache hit', hit, hit !== null ? `${Math.round(hit * 100)}%` : '–', tp !== null ? `${Math.round(tp)} tok/s` : `${kfmt(b.tokens.cacheRead)} read`, hit === null ? 'subtle' : hit > 0.7 ? 'success' : hit > 0.4 ? 'warning' : 'error'),
    gauge(W, 'Temp', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', v?.pct != null ? `bat ${v.pct}%${v.discharging ? '↓' : ''}` : '', v?.tempC != null ? lvl(v.tempC / cfg.maxTempC - 0.15) : 'subtle'),
    ...limits(b, W),
    gap,
    title('Context trend', f.burn !== null ? `+${f.burn.toFixed(1)}% / turn` : ''),
    { t: `  ${spark(b.ctxHist, sw, 100)}`, c: 'subtle' },
    title('Activity / min', `${b.activity[b.activity.length - 1] ?? 0} now`),
    { t: `  ${spark(b.activity.slice(-30), sw)}`, c: 'subtle' },
    title('Turns', r.perTurn !== null ? `${money(r.perTurn)} / turn · height = time` : 'height = time'),
    { t: `  ${spark(turns.map(t => t.ms), sw)}${b.running ? '▸' : ''}`, c: turns.some(t => t.reason !== 'answer') ? 'warning' : 'subtle' },
  ]
}

const context = (b: Board, W: number): Line[] => {
  const cp = b.comp
  const out: Line[] = []
  const mw = Math.max(8, W - 44)
  if (!cp) out.push(title('Context composition'), { t: '  measuring… (refreshes after each turn)', c: 'subtle' })
  else {
    const slices = cp.slices.slice().sort((x, z) => z.tokens - x.tokens)
    const used = slices.reduce((s, x) => s + x.tokens, 0)
    const max = Math.max(cp.max, used, 1)
    out.push(title('Context composition', `${kfmt(used)} of ${kfmt(max)}${cp.model ? ` · ${short(cp.model, 22)}` : ''}`))
    out.push({ t: `  ${bar(used / max, mw + 20)}`, c: lvl(used / max) })
    out.push({ t: cp.autoCompact && cp.compactAt ? `  auto-compact at ${kfmt(cp.compactAt)} (${Math.round(compactPct(b))}%)` : '  auto-compact off', c: 'subtle' })
    for (const s of slices) out.push({ t: `  ${pad(short(s.name, 22), 22)} ${bar(s.tokens / max, mw - 4)} ${lpad(kfmt(s.tokens), 6)} ${lpad(`${((s.tokens / max) * 100).toFixed(1)}%`, 6)}` })
  }
  const t = b.tokens
  const hit = cacheHit(t)
  const tp = throughput(b)
  out.push(
    gap,
    title('Tokens this session', hit !== null ? `${Math.round(hit * 100)}% served from cache` : ''),
    { t: `  cache read ${kfmt(t.cacheRead)} · cache write ${kfmt(t.cacheWrite)} · fresh ${kfmt(t.input)} · out ${kfmt(t.output)}${tp !== null ? ` · ${Math.round(tp)}/s` : ''}` },
  )
  const weight = ctxWeight(b).slice(0, 6)
  if (weight.length) {
    const top = weight[0]?.out ?? 1
    out.push(gap, title('Fed back by tools', `est. ${kfmt(weight.reduce((s, w) => s + w.out, 0))} tokens`))
    for (const w of weight) out.push({ t: `  ${pad(short(w.tool, 14), 14)} ${bar(w.out / top, mw + 4)} ${lpad(kfmt(w.out), 6)} ${lpad(`${Math.round(w.share * 100)}%`, 4)}` })
  }
  const heavy = fileWeight(b).slice(0, 5)
  if (heavy.length) {
    out.push(gap, title('Heaviest files', 'est. tokens fed · reads'))
    for (const f of heavy) out.push({ t: `  ${pad(shortPath(f.path, W - 20), W - 20)} ${lpad(kfmt(f.out), 6)} ${lpad(`${f.read}×`, 4)}` })
  }
  if (cp && (cp.memory.length || cp.mcp.length)) {
    out.push(gap, title('Always loaded', 'tokens'))
    for (const m of cp.memory.slice(0, 6)) out.push({ t: `  ${pad(shortPath(m.path, W - 14), W - 14)} ${lpad(kfmt(m.tokens), 6)}` })
    for (const m of cp.mcp.filter(x => x.loaded).slice(0, 6)) out.push({ t: `  ${pad(short(`${m.server} · ${m.name}`, W - 14), W - 14)} ${lpad(kfmt(m.tokens), 6)}` })
  }
  return out
}

const spend = (b: Board, cfg: Cfg, life: Lifetime | null, W: number): Line[] => {
  const r = costRate(b)
  const left = budgetRunway(b, cfg)
  const sw = Math.max(10, W - 24)
  const costed = b.turns.filter(t => t.usd !== null).slice(-sw)
  const out: Line[] = [
    title('Cost', left !== null ? `~${left} turns of budget left` : ''),
    { t: `  ${money(b.ctx?.usd)} this session${cfg.budgetUsd > 0 ? ` of ${money(cfg.budgetUsd)}` : ''}${r.perHour !== null ? ` · ${money(r.perHour)}/h` : ''}${r.perTurn !== null ? ` · ${money(r.perTurn)}/turn` : ''}${r.projected !== null ? ` · ~${money(r.projected)} in 10 turns` : ''}` },
  ]
  if (cfg.budgetUsd > 0) out.push(gauge(W, 'Budget', (b.ctx?.usd ?? 0) / cfg.budgetUsd, money(b.ctx?.usd)))
  out.push({ t: costed.length ? `  ${spark(costed.map(t => t.usd ?? 0), sw)}  per turn` : '  no costed turns yet', c: 'subtle' })
  const rows = modelSplit(b).slice(0, 5)
  out.push(gap, title('By model', 'share · turns · output · cost'))
  if (!rows.length) out.push({ t: '  no finished turns yet', c: 'subtle' })
  for (const m of rows) out.push({ t: `  ${pad(short(m.model, 20), 20)} ${bar(m.share, Math.max(6, W - 50))} ${lpad(`${m.turns}t`, 4)} ${lpad(kfmt(m.output), 6)} ${lpad(money(m.usd), 7)}` })
  if (life) {
    const days = lastDays(life, b.now, 30)
    const sum = days.reduce((s, d) => s + d.usd, 0)
    const today = days[days.length - 1]?.usd ?? 0
    const wk = weekCompare(life, b.now)
    out.push(
      gap,
      title('Last 30 days', `${money(sum)} · ${days.reduce((s, d) => s + d.turns, 0)} turns · ${days.filter(d => d.turns > 0).length} active days`),
      { t: `  ${spark(days.map(d => d.usd), 30)}  ${days[0]?.key.slice(5) ?? ''} → today`, c: 'subtle' },
      { t: `  today ${money(today)}${cfg.dailyBudgetUsd > 0 ? ` of ${money(cfg.dailyBudgetUsd)}` : ''}`, c: cfg.dailyBudgetUsd > 0 && today >= cfg.dailyBudgetUsd ? 'error' : undefined },
      { t: `  last 7 days ${money(wk.week)}${wk.change !== null ? ` · ${wk.change >= 0 ? '+' : ''}${Math.round(wk.change * 100)}% on the week before` : ''}`, c: wk.change !== null && wk.change > 0.25 ? 'warning' : 'subtle' },
    )
  }
  return out
}

const tools = (b: Board, W: number): Line[] => {
  const rows = toolBoard(b).slice(0, 14)
  const top = Math.max(1, ...rows.map(r => r.n))
  const bw = Math.max(6, W - 52)
  return [
    title('Tool leaderboard', 'calls · ok · avg · p95'),
    ...(rows.length ? [] : [{ t: '  no tool calls yet', c: 'subtle' } as Line]),
    ...rows.map(r => ({
      t: `  ${pad(short(r.tool, 14), 14)} ${bar(r.n / top, bw)} ${lpad(String(r.n), 4)} ${lpad(`${r.okPct}%`, 4)} ${lpad(dur(r.avg), 6)} ${lpad(dur(r.p95), 6)}`,
      c: r.fail + r.denied > 0 ? ('warning' as const) : undefined,
    })),
    gap,
  ]
}

const files = (b: Board, W: number): Line[] => {
  const rows = fileBoard(b).slice(0, 14)
  return [
    title('File heatmap', `${Object.keys(b.files).length} files · edit · write · read`),
    ...(rows.length ? [] : [{ t: '  no files touched yet', c: 'subtle' } as Line]),
    ...rows.map(f => ({
      t: `  ${pad(shortPath(f.path, W - 20), W - 20)} ${lpad(String(f.edit), 3)} ${lpad(String(f.write), 3)} ${lpad(String(f.read), 3)}`,
      c: f.edit + f.write === 0 ? ('subtle' as const) : f.edit + f.write >= 5 ? ('warning' as const) : undefined,
    })),
    gap,
  ]
}

const agents = (b: Board, W: number): Line[] => {
  const list = b.agents.slice(-12)
  const t0 = list.length ? Math.min(...list.map(a => a.startedAt)) : b.now
  const span = Math.max(1000, b.now - t0)
  const lw = Math.max(10, W - 40)
  return [
    title('Subagent swimlanes', list.length ? `window ${dur(span)}` : ''),
    ...(list.length ? [] : [{ t: '  no subagents yet', c: 'subtle' } as Line]),
    ...list.map(a => {
      const s = Math.floor(((a.startedAt - t0) / span) * lw)
      const e = Math.max(s + 1, Math.ceil((((a.endedAt ?? b.now) - t0) / span) * lw))
      const lane = ' '.repeat(s) + '█'.repeat(Math.min(lw, e) - s) + ' '.repeat(Math.max(0, lw - e))
      return {
        t: `  ${pad(short(a.type, 14), 14)} ${lane} ${lpad(`${a.tools}t`, 4)} ${lpad(dur((a.endedAt ?? b.now) - a.startedAt), 6)}`,
        c: a.status === 'run' ? ('warning' as const) : a.status === 'done' ? ('success' as const) : a.status === 'stopped' ? ('subtle' as const) : ('error' as const),
      }
    }),
    gap,
  ]
}

const system = (b: Board, cfg: Cfg, W: number): Line[] => {
  const v = b.vitals
  const th = cfg.threads || 8
  const comp = compliance(b)
  const peak = b.tempHist.length ? Math.round(Math.max(...b.tempHist)) : null
  return [
    title('Machine', v?.discharging ? 'on battery' : 'on AC'),
    gauge(W, 'Temp', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', `limit ${cfg.maxTempC}°`, v?.tempC != null ? lvl(v.tempC / cfg.maxTempC - 0.15) : 'subtle'),
    gauge(W, v?.discharging ? 'Battery ↓' : 'Battery', v?.pct != null ? v.pct / 100 : null, v?.pct != null ? `${v.pct}%` : '–', `floor ${cfg.minBatteryPct}%`, v?.pct != null ? lvl(1 - v.pct / 100) : 'subtle'),
    gauge(W, 'Memory', v?.memPct != null ? v.memPct / 100 : null, v?.memPct != null ? `${v.memPct}%` : '–'),
    gauge(W, 'Load', v?.load1 != null ? v.load1 / th : null, v?.load1 != null ? v.load1.toFixed(1) : '–', `${th} threads`),
    gap,
    title('Thermal trend', `${peak !== null ? `peak ${peak}° · ` : ''}limit ${cfg.maxTempC}°`),
    { t: `  ${spark(b.tempHist, Math.max(10, W - 4), Math.max(cfg.maxTempC + 10, ...b.tempHist))}`, c: peak !== null && peak > cfg.maxTempC ? 'error' : 'subtle' },
    gap,
    title('Guardrails', cfg.guard ? 'heat guard armed' : 'heat guard off'),
    cfg.prefix ? gauge(W, `${short(cfg.prefix, 6)} prefix`, comp !== null ? comp / 100 : null, comp !== null ? `${comp}%` : '–', `of ${b.bash.total}`, comp === null ? 'subtle' : comp >= 90 ? 'success' : comp >= 60 ? 'warning' : 'error') : { t: '  prefix compliance off', c: 'subtle' },
    { t: `  gate ${b.gate.allow} allowed · ${b.gate.ask} asked · ${b.gate.deny} denied`, c: b.gate.deny ? 'warning' : undefined },
    { t: `  held by heat guard: ${b.guardBlocks} heavy job${b.guardBlocks === 1 ? '' : 's'} · ${b.compactions} compactions`, c: b.guardBlocks ? 'error' : 'success' },
  ]
}

// The lines of one tab, for a body `cols` wide (80 when unknown). The log tab is drawn by the pane itself.
export const textPage = (tab: Tab, b: Board, cfg: Cfg, life: Lifetime | null, cols?: number): Line[] => {
  const W = Math.max(40, Math.min(160, cols ?? 80))
  if (tab === 'overview') return overview(b, cfg, W)
  if (tab === 'context') return context(b, W)
  if (tab === 'spend') return spend(b, cfg, life, W)
  if (tab === 'tools') return tools(b, W)
  if (tab === 'files') return files(b, W)
  if (tab === 'agents') return agents(b, W)
  if (tab === 'system') return system(b, cfg, W)
  return []
}

// The strip above the prompt, as one line.
export const textStrip = (b: Board, cfg: Cfg): Line => {
  const h = health(b, cfg)
  const c = b.ctx
  const v = b.vitals
  return {
    t: [
      `◆ ${h.grade}`,
      b.running ? `▸ ${dur(b.now - b.turnStart)}` : 'idle',
      c?.pct != null ? `ctx ${bar(c.pct / 100, 10)} ${Math.round(c.pct)}%` : '',
      v?.tempC != null ? `${Math.round(v.tempC)}°` : '',
      v?.pct != null ? `bat ${v.pct}%${v.discharging ? '↓' : ''}` : '',
      c?.usd != null ? money(c.usd) : '',
    ]
      .filter(Boolean)
      .join('  ·  '),
    c: lvl(c?.pct != null ? c.pct / 100 : null),
  }
}
