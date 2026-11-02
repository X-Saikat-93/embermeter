// What each tab says in the terminal, as coloured lines (segments.ts). The numbers come from core.ts, the same
// ones the SVG pages draw, so both surfaces always agree. Pure, no `$`.
import type { Board, Lifetime, Tab } from '../../types'
import type { Cfg } from '../core'
import {
  branchBoard,
  budgetRunway,
  cacheHit,
  cacheText,
  cacheWarmth,
  compactPct,
  compliance,
  costRate,
  ctxWeight,
  dayKey,
  dur,
  fileBoard,
  fileWeight,
  forecast,
  health,
  idleMcp,
  insights,
  kfmt,
  lastDays,
  limitEta,
  modelSplit,
  money,
  openJobs,
  rereads,
  short,
  shortPath,
  sinceCommit,
  streaks,
  throughput,
  toolBoard,
  turnOver,
  until,
  weekCompare,
  whatIf,
} from '../core'
import type { Anim, Line, Seg, Tone } from './segments'
import { fit, gap, heatCell, level, line, lpad, meter, pad, plain, seg, spark, title } from './segments'

// One gauge row: label, meter, value, note.
// Label 12 + meter + value 7 + note: the meter takes what the note (up to 14) leaves.
const gauge = (W: number, label: string, f: number | null, value: string, note = '', tone: Tone = 'heat', anim?: Anim): Line => {
  const mw = Math.max(6, W - 35)
  const room = W - 12 - mw - 7 - 2
  return line(
    seg(`${pad(label, 11)} `, 'sub'),
    ...meter(f, mw, tone, anim),
    seg(` ${lpad(value, 6)}`, f === null ? 'faint' : tone === 'heat' ? level(f) : 'ink'),
    ...(note && room > 2 ? [seg(`  ${short(note, room)}`, 'faint')] : []),
  )
}

const GRADE_TONE: Record<string, Tone> = { A: 'good', B: 'info', C: 'warn', D: 'bad', F: 'bad' }

export const termHeader = (b: Board, cfg: Cfg, cols?: number): Line[] => {
  const W = width(cols)
  const h = health(b, cfg)
  const busy = b.running || b.agents.some(a => a.status === 'run')
  const live = cfg.motion === 'smooth' && busy
  const cache = cacheText(b)
  const state = b.running ? `running ${dur(b.now - b.turnStart)}` : busy ? 'agents working' : `idle${cache ? ` · ${cache}` : ''}`
  const sc = sinceCommit(b)
  const where = [`turn ${b.turnCount}`, dur(b.now - b.startedAt), b.branch ? `on ${short(b.branch, 20)}` : '', sc?.files.length ? `${sc.files.length} changed since commit` : '', b.model ? short(b.model, 28) : ''].filter(Boolean).join(' · ')
  return [
    line(
      seg(` ${h.grade} `, GRADE_TONE[h.grade], live ? 'pulse' : undefined),
      seg(' Embermeter ', 'accent'),
      seg(`${h.score}/100 · ${h.reasons.length ? h.reasons.slice(0, 3).join(' · ') : 'all clear'}`, 'sub'),
    ),
    line(seg(busy ? '⠋' : '○', busy ? 'warn' : 'faint', live ? 'spin' : undefined), seg(` ${state}`, busy ? 'warn' : 'faint'), seg(` · ${where}`, 'faint')),
  ].map(l => fit(l, W))
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
      return gauge(W, l.kind.replace(/_/g, ' '), l.pct / 100, `${l.pct}%`, eta !== null ? `full ~${dur(eta)}` : until(l.resetsAt, b.now) || '–')
    }),
  ]
}

const insightLines = (b: Board, cfg: Cfg, W: number): Line[] => {
  const { costly, tips } = insights(b, cfg)
  if (!costly && !tips.length) return []
  const out: Line[] = [gap, title('Why it costs what it does')]
  if (costly) {
    const fed = costly.fed?.length ? costly.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : 'no tool output recorded'
    out.push(line(seg('  priciest turn ', 'sub'), seg(money(costly.usd), 'warn'), seg(` · ${dur(costly.ms)} · ${costly.tools} tools · fed by ${short(fed, W - 50)}`, 'sub')))
  }
  for (const t of tips) out.push(line(seg('  › ', 'accent'), seg(short(t, W - 4), 'ink')))
  return out
}

const overview = (b: Board, cfg: Cfg, W: number): Line[] => {
  const c = b.ctx
  const v = b.vitals
  const f = forecast(b)
  const r = costRate(b)
  const hit = cacheHit(b.tokens)
  const tp = throughput(b)
  const sw = Math.max(10, W - 4)
  const live = cfg.motion === 'smooth' && b.running ? 'flow' : undefined
  const turns = b.turns.slice(-sw)
  const stop = turnOver(b, cfg)
  return [
    title('Vitals', f.turnsLeft !== null ? `~${f.turnsLeft} turns to ${f.ceiling < 100 ? 'compaction' : 'full'}` : ''),
    gauge(W, 'Context', c?.pct != null ? c.pct / f.ceiling : null, c?.pct != null ? `${Math.round(c.pct)}%` : '–', `${kfmt(c?.tokens)}/${kfmt(c?.window)}`, 'heat', live),
    gauge(W, cfg.budgetUsd > 0 ? `Cost/$${cfg.budgetUsd}` : 'Cost', c?.usd != null ? (cfg.budgetUsd > 0 ? c.usd / cfg.budgetUsd : c.usd / 10) : null, money(c?.usd), r.perHour !== null ? `${money(r.perHour)}/h` : '', cfg.budgetUsd > 0 ? 'heat' : 'info'),
    gauge(W, 'Cache hit', hit, hit !== null ? `${Math.round(hit * 100)}%` : '–', tp !== null ? `${Math.round(tp)} tok/s` : `${kfmt(b.tokens.cacheRead)} read`, hit === null ? 'faint' : hit > 0.7 ? 'good' : hit > 0.4 ? 'warn' : 'bad'),
    gauge(W, 'Temp', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', v?.pct != null ? `bat ${v.pct}%${v.discharging ? '↓' : ''}` : ''),
    ...(stop ? [line(seg('  turn-cost stop: ', 'bad'), seg(stop, 'bad', live ? 'pulse' : undefined))] : []),
    ...limits(b, W),
    gap,
    title('Context trend', f.burn !== null ? `+${f.burn.toFixed(1)}% / turn` : ''),
    line(seg('  '), ...spark(b.ctxHist, sw - 2, 100, 'heat')),
    title('Activity / min', `${b.activity[b.activity.length - 1] ?? 0} now`),
    line(seg('  '), ...spark(b.activity.slice(-sw + 2), sw - 2, undefined, 'info'), ...(b.running ? [seg('▸', 'warn', live ? 'pulse' : undefined)] : [])),
    title('Turns', r.perTurn !== null ? `${money(r.perTurn)} / turn · height = time` : 'height = time'),
    line(seg('  '), ...(turns.length ? spark(turns.map(t => t.ms), sw - 2, undefined, 'heat') : [seg('no turns yet', 'faint')])),
    ...insightLines(b, cfg, W),
  ]
}

const SLICE_TONES: Tone[] = ['info', 'good', 'accent', 'warn', 'sub', 'bad', 'faint']

const context = (b: Board, life: Lifetime | null, W: number): Line[] => {
  const cp = b.comp
  const out: Line[] = []
  const mw = Math.max(8, W - 44)
  if (!cp) out.push(title('Context composition'), plain('  measuring… (refreshes after each turn)', 'faint'))
  else {
    const slices = cp.slices.slice().sort((x, z) => z.tokens - x.tokens)
    const used = slices.reduce((s, x) => s + x.tokens, 0)
    const max = Math.max(cp.max, used, 1)
    out.push(title('Context composition', `${kfmt(used)} of ${kfmt(max)}${cp.model ? ` · ${short(cp.model, 22)}` : ''}`))
    // The window as one stacked bar, a segment per slice, then the free space.
    const bw = Math.max(10, W - 4)
    const stacked: Seg[] = []
    let usedCells = 0
    slices.forEach((s, i) => {
      const n = Math.round((s.tokens / max) * bw)
      if (n > 0) stacked.push(seg('█'.repeat(n), SLICE_TONES[i % SLICE_TONES.length]))
      usedCells += n
    })
    if (bw - usedCells > 0) stacked.push(seg('░'.repeat(bw - usedCells), 'faint'))
    out.push(line(seg('  '), ...stacked))
    out.push(plain(cp.autoCompact && cp.compactAt ? `  auto-compact at ${kfmt(cp.compactAt)} (${Math.round(compactPct(b))}%)` : '  auto-compact off', cp.autoCompact ? 'bad' : 'faint'))
    slices.forEach((s, i) =>
      out.push(line(seg('  ■ ', SLICE_TONES[i % SLICE_TONES.length]), seg(pad(short(s.name, 20), 20), 'ink'), seg(' '), ...meter(s.tokens / max, mw - 4, SLICE_TONES[i % SLICE_TONES.length]), seg(` ${lpad(kfmt(s.tokens), 6)} ${lpad(`${((s.tokens / max) * 100).toFixed(1)}%`, 6)}`, 'sub'))),
    )
  }
  const t = b.tokens
  const hit = cacheHit(t)
  const tp = throughput(b)
  out.push(
    gap,
    title('Tokens this session', hit !== null ? `${Math.round(hit * 100)}% served from cache` : ''),
    line(seg('  cache read ', 'sub'), seg(kfmt(t.cacheRead), 'good'), seg(' · cache write ', 'sub'), seg(kfmt(t.cacheWrite), 'accent'), seg(' · fresh ', 'sub'), seg(kfmt(t.input), 'info'), seg(' · out ', 'sub'), seg(kfmt(t.output), 'warn'), seg(tp !== null ? ` · ${Math.round(tp)}/s` : '', 'sub')),
  )
  const weight = ctxWeight(b).slice(0, 6)
  if (weight.length) {
    const top = weight[0]?.out ?? 1
    out.push(gap, title('Fed back by tools', `est. ${kfmt(weight.reduce((s, w) => s + w.out, 0))} tokens`))
    weight.forEach((w, i) => out.push(line(seg(`  ${pad(short(w.tool, 14), 14)} `, 'ink'), ...meter(w.out / top, mw + 4, i === 0 ? 'warn' : 'info'), seg(` ${lpad(kfmt(w.out), 6)} ${lpad(`${Math.round(w.share * 100)}%`, 4)}`, 'sub'))))
  }
  const heavy = fileWeight(b).slice(0, 5)
  if (heavy.length) {
    out.push(gap, title('Heaviest files', 'est. tokens fed · reads'))
    heavy.forEach((f, i) => out.push(line(seg(`  ${pad(shortPath(f.path, W - 20), W - 20)} `, 'ink'), seg(lpad(kfmt(f.out), 6), i === 0 ? 'warn' : 'sub'), seg(` ${lpad(`${f.read}×`, 4)}`, 'faint'))))
  }
  const rr = rereads(b)
  if (rr.rows.length) {
    out.push(gap, title('Read again', `~${kfmt(rr.waste)} tokens repeated`))
    for (const f of rr.rows.slice(0, 5)) out.push(line(seg(`  ${pad(shortPath(f.path, W - 22), W - 22)} `, 'ink'), seg(lpad(`${f.read}×`, 4), 'warn'), seg(` ${lpad(kfmt(f.waste), 6)}`, 'sub')))
  }
  if (cp && (cp.memory.length || cp.mcp.length)) {
    out.push(gap, title('Always loaded', 'tokens'))
    for (const m of cp.memory.slice(0, 6)) out.push(line(seg(`  ${pad(shortPath(m.path, W - 14), W - 14)} `, 'ink'), seg(lpad(kfmt(m.tokens), 6), 'sub')))
    for (const m of cp.mcp.filter(x => x.loaded).slice(0, 6)) out.push(line(seg(`  ${pad(short(`${m.server} · ${m.name}`, W - 14), W - 14)} `, 'ink'), seg(lpad(kfmt(m.tokens), 6), 'sub')))
  }
  const idle = idleMcp(b, life)
  if (idle.length) {
    out.push(gap, title('Loaded, never called', 'MCP server · tokens every request'))
    for (const r of idle.slice(0, 5)) out.push(line(seg(`  ${pad(short(r.server, W - 30), W - 30)} `, 'ink'), seg(lpad(kfmt(r.tokens), 6), 'warn'), seg(`  ${r.sessions > 1 ? `${r.sessions} sessions` : 'this session'}`, 'faint')))
  }
  const lc = b.lastCompact
  if (lc) {
    out.push(gap, title('Last compaction', `${dur(b.now - lc.at)} ago · ${lc.trigger}`))
    if (lc.before !== null && lc.after !== null) out.push(line(seg('  '), seg(kfmt(lc.before), 'warn'), seg(' → ', 'faint'), seg(kfmt(lc.after), 'good'), seg(' tokens', 'sub')))
    out.push(plain(`  was feeding: ${lc.fed.length ? lc.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : 'no tool output recorded'}`, 'sub'))
  }
  return out
}

const spend = (b: Board, cfg: Cfg, life: Lifetime | null, W: number): Line[] => {
  const r = costRate(b)
  const left = budgetRunway(b, cfg)
  const sw = Math.max(10, W - 4)
  const costed = b.turns.filter(t => t.usd !== null).slice(-(sw - 2))
  const out: Line[] = [
    title('Cost', left !== null ? `~${left} turns of budget left` : ''),
    line(
      seg('  '),
      seg(money(b.ctx?.usd), 'warn'),
      seg(` this session${cfg.budgetUsd > 0 ? ` of ${money(cfg.budgetUsd)}` : ''}${r.perHour !== null ? ` · ${money(r.perHour)}/h` : ''}${r.perTurn !== null ? ` · ${money(r.perTurn)}/turn` : ''}${r.projected !== null ? ` · ~${money(r.projected)} in 10 turns` : ''}`, 'sub'),
    ),
  ]
  if (cfg.budgetUsd > 0) out.push(gauge(W, 'Budget', (b.ctx?.usd ?? 0) / cfg.budgetUsd, money(b.ctx?.usd)))
  if (cfg.turnBudgetUsd > 0) out.push(plain(`  turn-cost stop at ${money(cfg.turnBudgetUsd)} a turn`, 'faint'))
  out.push(costed.length ? line(seg('  '), ...spark(costed.map(t => t.usd ?? 0), sw - 2, undefined, 'heat')) : plain('  no costed turns yet', 'faint'))
  const rows = modelSplit(b).slice(0, 5)
  out.push(gap, title('By model', 'share · turns · output · cost'))
  if (!rows.length) out.push(plain('  no finished turns yet', 'faint'))
  rows.forEach((m, i) =>
    out.push(line(seg(`  ${pad(short(m.model, 20), 20)} `, 'ink'), ...meter(m.share, Math.max(6, W - 50), (['warn', 'info', 'good', 'accent', 'sub'] as Tone[])[i] ?? 'info'), seg(` ${lpad(`${m.turns}t`, 4)} ${lpad(kfmt(m.output), 6)} `, 'sub'), seg(lpad(money(m.usd), 7), 'ink'))),
  )
  const alt = whatIf(b)
  if (alt.length) {
    out.push(gap, title('Same tokens, cheaper model', `list price · ${alt[0]?.turns} main-thread turns`))
    out.push(line(seg(`  ${pad('as run', 20)} `, 'sub'), seg(lpad(money(alt[0]?.actual), 7), 'ink')))
    for (const a of alt) out.push(line(seg(`  ${pad(a.model, 20)} `, 'ink'), seg(lpad(money(a.usd), 7), 'good'), seg(`  ${Math.round((1 - a.usd / a.actual) * 100)}% less`, 'faint')))
  }
  const priciest = b.turns.filter(t => t.usd !== null && t.usd > 0).slice(-12).sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0)).slice(0, 3)
  if (priciest.length) {
    out.push(gap, title('Priciest turns', 'what fed them'))
    for (const t of priciest) out.push(line(seg(`  ${lpad(money(t.usd), 7)} `, 'warn'), seg(`${lpad(dur(t.ms), 6)} · ${t.tools} tools · `, 'sub'), seg(short(t.fed?.length ? t.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : '–', W - 34), 'ink')))
  }
  if (life) {
    const days = lastDays(life, b.now, 30)
    const sum = days.reduce((s, d) => s + d.usd, 0)
    const today = days[days.length - 1]?.usd ?? 0
    const wk = weekCompare(life, b.now)
    out.push(
      gap,
      title('Last 30 days', `${money(sum)} · ${days.reduce((s, d) => s + d.turns, 0)} turns · ${days.filter(d => d.turns > 0).length} active days`),
      line(seg('  '), ...spark(days.map(d => d.usd), 30, undefined, 'heat'), seg(`  ${days[0]?.key.slice(5) ?? ''} → today`, 'faint')),
      line(seg('  today '), seg(money(today), cfg.dailyBudgetUsd > 0 && today >= cfg.dailyBudgetUsd ? 'bad' : 'warn'), seg(cfg.dailyBudgetUsd > 0 ? ` of ${money(cfg.dailyBudgetUsd)}` : '', 'sub')),
      plain(`  last 7 days ${money(wk.week)}${wk.change !== null ? ` · ${wk.change >= 0 ? '+' : ''}${Math.round(wk.change * 100)}% on the week before` : ''}`, wk.change !== null && wk.change > 0.25 ? 'warn' : 'sub'),
    )
    const branches = branchBoard(life).slice(0, 6)
    if (branches.length) {
      out.push(gap, title('By branch', 'all time · sessions · turns · cost'))
      for (const x of branches)
        out.push(line(seg(`  ${x.branch === b.branch ? '▸' : ' '} ${pad(short(x.branch, W - 30), W - 30)} `, 'ink'), seg(`${lpad(`${x.sessions}s`, 4)} ${lpad(`${x.turns}t`, 5)} `, 'sub'), seg(lpad(money(x.usd), 7), 'warn')))
    }
    const recent = (life.recent ?? []).slice(-6).reverse()
    if (recent.length) {
      out.push(gap, title('Recent sessions', 'grade · length · turns · cost'))
      for (const s of recent)
        out.push(line(seg(`  ${s.at === b.startedAt ? '▸' : ' '} ${dayKey(s.at).slice(5)} `, 'sub'), seg(` ${s.grade} `, GRADE_TONE[s.grade]), seg(` ${lpad(dur(s.ms), 6)} ${lpad(`${s.turns}t`, 4)} ${lpad(`${s.calls}c`, 5)} `, 'sub'), seg(lpad(money(s.usd), 7), 'ink'), seg(s.branch ? `  ${short(s.branch, Math.max(4, W - 40))}` : '', 'faint')))
    }
  }
  return out
}

const tools = (b: Board, W: number): Line[] => {
  const rows = toolBoard(b).slice(0, 14)
  const top = Math.max(1, ...rows.map(r => r.n))
  const bw = Math.max(3, W - 47)
  const out: Line[] = [title('Tool leaderboard', 'calls · ok · avg · p95'), ...(rows.length ? [] : [plain('  no tool calls yet', 'faint')])]
  for (const r of rows)
    out.push(line(seg(`  ${pad(short(r.tool, 14), 14)} `, 'ink'), ...meter(r.n / top, bw, 'info'), seg(` ${lpad(String(r.n), 4)} `, 'sub'), seg(lpad(`${r.okPct}%`, 4), r.okPct >= 95 ? 'good' : r.okPct >= 80 ? 'warn' : 'bad'), seg(` ${lpad(dur(r.avg), 6)} ${lpad(dur(r.p95), 6)}`, 'sub')))
  const st = streaks(b)
  if (st.length) {
    out.push(gap, title('Failing in a row'))
    for (const s of st.slice(0, 4)) out.push(line(seg(`  ${pad(short(s.tool, 14), 14)} `, 'ink'), seg(`${s.n}× `, 'bad'), seg(short(s.detail, W - 24), 'sub')))
  }
  const runs = b.tests.slice(-5).reverse()
  if (runs.length) {
    out.push(gap, title('Test runs', b.tests.length > 1 ? `failing ${b.tests.slice(-6).map(t => t.fail).join(' → ')}` : ''))
    for (const t of runs) out.push(line(seg(`  ${lpad(dur(b.now - t.at), 6)} ago `, 'faint'), seg(lpad(`${t.pass} pass`, 9), 'good'), seg(lpad(`${t.fail} fail`, 8), t.fail ? 'bad' : 'faint'), seg(`  ${short(t.cmd, W - 30)}`, 'sub')))
  }
  out.push(gap)
  return out
}

const files = (b: Board, W: number): Line[] => {
  const rows = fileBoard(b).slice(0, 14)
  const top = Math.max(1, ...rows.map(f => f.edit + f.write))
  return [
    title('File heatmap', `${Object.keys(b.files).length} files · edit · write · read`),
    ...(rows.length ? [] : [plain('  no files touched yet', 'faint')]),
    ...rows.map(f => {
      const changes = f.edit + f.write
      return line(
        seg('  '),
        changes ? heatCell('■', changes / top) : seg('■', 'faint'),
        seg(` ${pad(shortPath(f.path, W - 20), W - 20)}`, changes ? 'ink' : 'sub'),
        seg(` ${lpad(String(f.edit), 3)} ${lpad(String(f.write), 3)} ${lpad(String(f.read), 3)}`, 'sub'),
      )
    }),
    gap,
  ]
}

const agents = (b: Board, cfg: Cfg, W: number): Line[] => {
  const list = b.agents.slice(-12)
  const t0 = list.length ? Math.min(...list.map(a => a.startedAt)) : b.now
  const span = Math.max(1000, b.now - t0)
  const lw = Math.max(6, W - 40)
  const tone = (s: string): Tone => (s === 'run' ? 'warn' : s === 'done' ? 'good' : s === 'stopped' ? 'faint' : 'bad')
  return [
    title('Subagent swimlanes', list.length ? `window ${dur(span)} · tools · tokens · time` : ''),
    ...(list.length ? [] : [plain('  no subagents yet', 'faint')]),
    ...list.map(a => {
      const s = Math.min(lw - 1, Math.floor(((a.startedAt - t0) / span) * lw))
      const e = Math.min(lw, Math.max(s + 1, Math.ceil((((a.endedAt ?? b.now) - t0) / span) * lw)))
      return line(
        seg(`  ${pad(short(a.type, 14), 14)} `, 'ink'),
        seg(' '.repeat(s), 'faint'),
        seg('█'.repeat(e - s), tone(a.status), a.status === 'run' && cfg.motion === 'smooth' ? 'flow' : undefined),
        seg(`${' '.repeat(lw - e)} `, 'faint'),
        seg(`${lpad(`${a.tools}t`, 4)} ${lpad(a.tokens ? kfmt(a.tokens) : '–', 6)} ${lpad(dur((a.endedAt ?? b.now) - a.startedAt), 6)}`, 'sub'),
      )
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
    gauge(W, 'Temp', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', `limit ${cfg.maxTempC}°`),
    gauge(W, v?.discharging ? 'Battery ↓' : 'Battery', v?.pct != null ? v.pct / 100 : null, v?.pct != null ? `${v.pct}%` : '–', `floor ${cfg.minBatteryPct}%`, v?.pct == null ? 'faint' : v.pct > 50 ? 'good' : v.pct > cfg.minBatteryPct ? 'warn' : 'bad'),
    gauge(W, 'Memory', v?.memPct != null ? v.memPct / 100 : null, v?.memPct != null ? `${v.memPct}%` : '–', cfg.maxMemPct > 0 ? `limit ${cfg.maxMemPct}%` : ''),
    gauge(W, 'Load', v?.load1 != null ? v.load1 / th : null, v?.load1 != null ? v.load1.toFixed(1) : '–', `${th} threads`),
    gap,
    title('Thermal trend', `${peak !== null ? `peak ${peak}° · ` : ''}limit ${cfg.maxTempC}°`),
    line(seg('  '), ...spark(b.tempHist, Math.max(10, W - 4), Math.max(cfg.maxTempC + 10, ...b.tempHist), 'heat')),
    gap,
    title('Guardrails', cfg.guard ? 'heat guard armed' : 'heat guard off'),
    cfg.prefix
      ? gauge(W, `${short(cfg.prefix, 6)} prefix`, comp !== null ? comp / 100 : null, comp !== null ? `${comp}%` : '–', `of ${b.bash.total}`, comp === null ? 'faint' : comp >= 90 ? 'good' : comp >= 60 ? 'warn' : 'bad')
      : plain('  prefix compliance off', 'faint'),
    line(seg('  gate '), seg(`${b.gate.allow} allowed`, 'good'), seg(' · '), seg(`${b.gate.ask} asked`, 'info'), seg(' · '), seg(`${b.gate.deny} denied`, b.gate.deny ? 'bad' : 'sub')),
    line(seg('  held by guards '), seg(`${b.guardBlocks} call${b.guardBlocks === 1 ? '' : 's'}`, b.guardBlocks ? 'bad' : 'good'), seg(` · ${b.compactions} compactions`, 'sub')),
    plain(
      `  ${[cfg.pauseOnBattery ? 'pause on battery' : '', cfg.maxMemPct > 0 ? `memory ≤ ${cfg.maxMemPct}%` : '', cfg.turnBudgetUsd > 0 ? `turn ≤ ${money(cfg.turnBudgetUsd)}` : '', cfg.loopBreak ? 'loop breaker' : ''].filter(Boolean).join(' · ') || 'extra guards off'}`,
      'faint',
    ),
    ...jobLines(b, W),
  ]
}

const jobLines = (b: Board, W: number): Line[] => {
  const list = b.jobs.slice(-6).reverse()
  if (!list.length) return []
  return [
    gap,
    title('Background jobs', `${openJobs(b).length} running`),
    ...list.map(j =>
      line(
        seg(`  ${j.end === null ? '▸' : '□'} `, j.end === null ? 'warn' : 'faint'),
        seg(pad(short(j.cmd, W - 26), W - 26), j.end === null ? 'ink' : 'sub'),
        seg(` ${lpad(j.end === null ? dur(b.now - j.at) : short(j.status, 9), 9)}`, j.end === null ? 'warn' : 'faint'),
      ),
    ),
  ]
}

// The lines of one tab, for a body `cols` wide (80 when unknown). The log tab is drawn by the pane itself.
const width = (cols?: number) => Math.max(40, Math.min(160, cols ?? 80))

const PAGES: Partial<Record<Tab, (b: Board, cfg: Cfg, life: Lifetime | null, W: number) => Line[]>> = {
  overview: (b, cfg, _l, W) => overview(b, cfg, W),
  context: (b, _c, l, W) => context(b, l, W),
  spend: spend,
  tools: (b, _c, _l, W) => tools(b, W),
  files: (b, _c, _l, W) => files(b, W),
  agents: (b, cfg, _l, W) => agents(b, cfg, W),
  system: (b, cfg, _l, W) => system(b, cfg, W),
}

// The lines of one tab for a body `cols` wide (80 when unknown), each clipped to it. The log tab is the pane's own.
export const termPage = (tab: Tab, b: Board, cfg: Cfg, life: Lifetime | null, cols?: number): Line[] => {
  const W = width(cols)
  return (PAGES[tab]?.(b, cfg, life, W) ?? []).map(l => fit(l, W))
}

// The strip above the prompt, as one line.
export const termStrip = (b: Board, cfg: Cfg): Line => {
  const h = health(b, cfg)
  const c = b.ctx
  const v = b.vitals
  const live = cfg.motion === 'smooth' && b.running
  const sep = seg('  ·  ', 'faint')
  const parts: Seg[][] = [
    [seg(` ${h.grade} `, GRADE_TONE[h.grade], live ? 'pulse' : undefined)],
    b.running ? [seg('⠋', 'warn', live ? 'spin' : undefined), seg(` ${dur(b.now - b.turnStart)}`, 'warn')] : [seg('idle', 'faint')],
  ]
  if (c?.pct != null) parts.push([seg('ctx ', 'sub'), ...meter(c.pct / 100, 10, 'heat', live ? 'flow' : undefined), seg(` ${Math.round(c.pct)}%`, level(c.pct / 100))])
  if (v?.tempC != null) parts.push([seg(`${Math.round(v.tempC)}°`, level(v.tempC / (cfg.maxTempC + 5)))])
  if (v?.pct != null) parts.push([seg(`bat ${v.pct}%${v.discharging ? '↓' : ''}`, v.discharging && v.pct < cfg.minBatteryPct ? 'bad' : 'sub')])
  if (c?.usd != null) parts.push([seg(money(c.usd), 'warn')])
  const w = cacheWarmth(b)
  if (w) parts.push([seg(cacheText(b), w.leftMs < 1000 ? 'faint' : w.leftMs <= 60_000 ? 'warn' : 'good')])
  return { segs: parts.flatMap((p, i) => (i ? [sep, ...p] : p)) }
}
