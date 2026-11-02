// What each tab says in the terminal, as coloured lines (segments.ts). The numbers come from core.ts, the same
// ones the SVG pages draw, so both surfaces always agree. Pure, no `$`.
//
// The look: capital section labels on a rule that fades from the accent, thin gradient meters with a red line
// where a limit sits, two-row charts, pills for grades and dotted leaders for lists. Motion (a spinner, a pulse,
// a highlight sweeping the live meters) runs only while work does.
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
import { chart, fit, gap, heatCell, leader, level, line, lpad, meter, pad, pill, plain, ruled, seg, title } from './segments'

const GRADE_TONE: Record<string, Tone> = { A: 'good', B: 'info', C: 'warn', D: 'bad', F: 'bad' }

// One gauge row: label, a thin meter, the value, a note. The meter takes what the label (11), value (7) and the
// note (up to 16) leave.
const gauge = (W: number, label: string, f: number | null, value: string, note = '', tone: Tone = 'heat', anim?: Anim, mark?: number, valueTone?: Tone): Line => {
  const mw = Math.max(6, W - 36)
  const room = W - mw - 20
  return line(
    seg(`${pad(label, 10)} `, 'sub'),
    ...meter(f, mw, tone, anim, mark),
    seg(` ${lpad(value, 6)}`, valueTone ?? (f === null ? 'faint' : tone === 'heat' ? level(f) : 'ink')),
    ...(note && room > 2 ? [seg(`  ${short(note, room)}`, 'faint')] : []),
  )
}

// A two-row chart under its label, the value to its right; with `live`, a pulsing marker after the newest column.
const trend = (W: number, label: string, values: number[], max: number | undefined, tone: Tone, value: string, live = false, floor = 0): Line[] => {
  const cw = Math.max(8, W - 26)
  const [top = [], bottom = []] = chart(values, cw, 2, max, tone, floor)
  const fill = (row: Seg[]) => [...row, seg(' '.repeat(Math.max(0, cw - row.reduce((n, s) => n + [...s.t].length, 0))))]
  return [
    line(seg(' '.repeat(11)), ...fill(top)),
    line(seg(`${pad(label, 10)} `, 'sub'), ...fill(bottom), seg(live ? ' ▸' : '  ', 'warn', live ? 'pulse' : undefined), seg(` ${value}`, 'ink')),
  ]
}

// A run of cells grouped into segments: one per stretch of the same glyph and tone.
const runs = (cells: [string, Tone][]): Seg[] => {
  const out: Seg[] = []
  for (const [ch, tone] of cells) {
    const last = out[out.length - 1]
    if (last && last.tone === tone && last.t[0] === ch) last.t += ch
    else out.push(seg(ch, tone))
  }
  return out
}

export const termHeader = (b: Board, cfg: Cfg, cols?: number): Line[] => {
  const W = width(cols)
  const h = health(b, cfg)
  const busy = b.running || b.agents.some(a => a.status === 'run')
  const live = cfg.motion === 'smooth' && busy
  const state = b.running ? `running ${dur(b.now - b.turnStart)}` : busy ? 'agents working' : 'idle'
  const w = cacheWarmth(b)
  const sc = sinceCommit(b)
  const where = [`turn ${b.turnCount}`, dur(b.now - b.startedAt), b.branch ? `on ${short(b.branch, 20)}` : '', sc?.files.length ? `${sc.files.length} changed since commit` : '', b.model ? short(b.model, 28) : ''].filter(Boolean).join(' · ')
  return [
    line(
      seg('◉', 'accent', live ? 'pulse' : undefined),
      seg(' EMBERMETER', 'accent'),
      seg('   grade ', 'faint'),
      pill(` ${h.grade} `, GRADE_TONE[h.grade] ?? 'info'),
      seg(` ${h.score}`, 'ink'),
      seg('/100', 'faint'),
      seg(`   ${h.reasons.length ? h.reasons.slice(0, 3).join(' · ') : 'all clear'}`, h.reasons.length ? 'sub' : 'good'),
    ),
    line(
      seg(busy ? '⠋' : '◦', busy ? 'warn' : 'faint', live ? 'spin' : undefined),
      seg(` ${state}`, busy ? 'warn' : 'sub'),
      ...(w ? [seg(`  ${cacheText(b)}`, w.leftMs < 1000 ? 'faint' : w.leftMs <= 60_000 ? 'warn' : 'good')] : []),
      seg(`   ${where}`, 'faint'),
    ),
  ].map(l => fit(l, W))
}

const limits = (b: Board, W: number): Line[] => {
  const ls = b.ctx?.limits ?? []
  if (!ls.length) return []
  const etas = limitEta(b)
  return [
    gap,
    title('Rate limits', 'resets in, or fills in at this pace'),
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
    out.push(line(seg('  priciest turn  ', 'sub'), pill(` ${money(costly.usd)} `, 'warn'), seg(`  ${dur(costly.ms)} · ${costly.tools} tools · fed by ${short(fed, W - 50)}`, 'sub')))
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
  const live = cfg.motion === 'smooth' && b.running ? 'flow' : undefined
  const stop = turnOver(b, cfg)
  return [
    title('Vitals', f.turnsLeft !== null ? `~${f.turnsLeft} turns to ${f.ceiling < 100 ? 'compaction' : 'full'}` : '', live),
    gauge(W, 'Context', c?.pct != null ? c.pct / 100 : null, c?.pct != null ? `${Math.round(c.pct)}%` : '–', `${kfmt(c?.tokens)}/${kfmt(c?.window)}`, 'heat', live, f.ceiling < 100 ? f.ceiling / 100 : undefined, c?.pct != null ? level(c.pct / f.ceiling) : undefined),
    gauge(
      W,
      cfg.budgetUsd > 0 ? `Cost/$${cfg.budgetUsd}` : 'Cost',
      c?.usd != null ? (cfg.budgetUsd > 0 ? c.usd / cfg.budgetUsd : c.usd / 10) : null,
      money(c?.usd),
      r.perHour !== null ? `${money(r.perHour)}/h` : '',
      cfg.budgetUsd > 0 ? 'heat' : 'cool',
      live,
    ),
    gauge(W, 'Cache hit', hit, hit !== null ? `${Math.round(hit * 100)}%` : '–', tp !== null ? `${Math.round(tp)} tok/s` : `${kfmt(b.tokens.cacheRead)} read`, 'cool', undefined, undefined, hit === null ? 'faint' : hit > 0.7 ? 'good' : hit > 0.4 ? 'warn' : 'bad'),
    gauge(W, 'Temp', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', v?.pct != null ? `bat ${v.pct}%${v.discharging ? '↓' : ''}` : '', 'heat', undefined, cfg.maxTempC / (cfg.maxTempC + 15)),
    ...(stop ? [line(seg('  '), pill(' TURN STOP ', 'bad', live ? 'pulse' : undefined), seg(`  ${stop}`, 'bad'))] : []),
    ...limits(b, W),
    gap,
    title('Trends', f.burn !== null ? `context +${f.burn.toFixed(1)}% a turn` : ''),
    ...trend(W, 'Context', b.ctxHist, 100, 'heat', c?.pct != null ? `${Math.round(c.pct)}%` : '–'),
    ...trend(W, 'Activity', b.activity, undefined, 'cool', `${b.activity[b.activity.length - 1] ?? 0}/min`, Boolean(live)),
    ...trend(W, 'Turns', b.turns.map(t => t.ms), undefined, 'heat', r.perTurn !== null ? `${money(r.perTurn)}/turn` : `${b.turns.length} done`),
    ...insightLines(b, cfg, W),
  ]
}

const SLICE_TONES: Tone[] = ['info', 'good', 'accent', 'warn', 'sub', 'bad', 'faint']

const context = (b: Board, life: Lifetime | null, W: number): Line[] => {
  const cp = b.comp
  const out: Line[] = []
  const mw = Math.max(6, W - 38)
  if (!cp) out.push(title('Context composition'), plain('  measuring… (refreshes after each turn)', 'faint'))
  else {
    const slices = cp.slices.slice().sort((x, z) => z.tokens - x.tokens)
    const used = slices.reduce((s, x) => s + x.tokens, 0)
    const max = Math.max(cp.max, used, 1)
    out.push(title('Context composition', `${kfmt(used)} of ${kfmt(max)}${cp.model ? ` · ${short(cp.model, 22)}` : ''}`))
    // The window as one stacked rule, a stretch per slice, the free space faint, and the compaction point in red.
    const bw = Math.max(10, W - 4)
    const cells: [string, Tone][] = []
    slices.forEach((s, i) => {
      for (let k = Math.round((s.tokens / max) * bw); k > 0 && cells.length < bw; k--) cells.push(['━', SLICE_TONES[i % SLICE_TONES.length] ?? 'info'])
    })
    while (cells.length < bw) cells.push(['─', 'faint'])
    const cut = cp.autoCompact && cp.compactAt ? Math.min(bw - 1, Math.round((cp.compactAt / max) * bw)) : -1
    if (cut >= 0) cells[cut] = ['┊', 'bad']
    out.push(line(seg('  '), ...runs(cells)))
    out.push(plain(cp.autoCompact && cp.compactAt ? `  ┊ auto-compact at ${kfmt(cp.compactAt)} (${Math.round(compactPct(b))}%)` : '  auto-compact off', cp.autoCompact ? 'bad' : 'faint'))
    out.push(gap)
    slices.forEach((s, i) => {
      const tone = SLICE_TONES[i % SLICE_TONES.length] ?? 'info'
      out.push(line(seg('  ■ ', tone), seg(pad(short(s.name, 18), 18), 'ink'), seg(' '), ...meter(s.tokens / max, mw, tone), seg(` ${lpad(kfmt(s.tokens), 6)} ${lpad(`${((s.tokens / max) * 100).toFixed(1)}%`, 6)}`, 'sub')))
    })
  }
  const t = b.tokens
  const hit = cacheHit(t)
  const tp = throughput(b)
  out.push(
    gap,
    title('Tokens this session', hit !== null ? `${Math.round(hit * 100)}% served from cache` : ''),
    line(seg('  cache read ', 'sub'), seg(kfmt(t.cacheRead), 'good'), seg('  ·  write ', 'sub'), seg(kfmt(t.cacheWrite), 'accent'), seg('  ·  fresh ', 'sub'), seg(kfmt(t.input), 'info'), seg('  ·  out ', 'sub'), seg(kfmt(t.output), 'warn'), seg(tp !== null ? `  ·  ${Math.round(tp)}/s` : '', 'sub')),
  )
  const weight = ctxWeight(b).slice(0, 6)
  if (weight.length) {
    const top = weight[0]?.out ?? 1
    out.push(gap, title('Fed back by tools', `est. ${kfmt(weight.reduce((s, w) => s + w.out, 0))} tokens`))
    weight.forEach((w, i) => out.push(line(seg(`  ${pad(short(w.tool, 14), 14)} `, 'ink'), ...meter(w.out / top, mw + 4, i === 0 ? 'heat' : 'cool'), seg(` ${lpad(kfmt(w.out), 6)} ${lpad(`${Math.round(w.share * 100)}%`, 4)}`, 'sub'))))
  }
  const heavy = fileWeight(b).slice(0, 5)
  if (heavy.length) {
    out.push(gap, title('Heaviest files', 'est. tokens fed · reads'))
    heavy.forEach((f, i) => out.push(leader(W, [seg(shortPath(f.path, W), 'ink')], [seg(lpad(kfmt(f.out), 5), i === 0 ? 'warn' : 'sub'), seg(` ${lpad(`${f.read}×`, 3)}`, 'faint')])))
  }
  const rr = rereads(b)
  if (rr.rows.length) {
    out.push(gap, title('Read again', `~${kfmt(rr.waste)} tokens repeated`))
    for (const f of rr.rows.slice(0, 5)) out.push(leader(W, [seg(shortPath(f.path, W), 'ink')], [seg(lpad(`${f.read}×`, 3), 'warn'), seg(` ${lpad(kfmt(f.waste), 5)}`, 'sub')]))
  }
  if (cp && (cp.memory.length || cp.mcp.length)) {
    out.push(gap, title('Always loaded', 'tokens every request'))
    for (const m of cp.memory.slice(0, 6)) out.push(leader(W, [seg(shortPath(m.path, W), 'ink')], [seg(lpad(kfmt(m.tokens), 5), 'sub')]))
    for (const m of cp.mcp.filter(x => x.loaded).slice(0, 6)) out.push(leader(W, [seg(m.server, 'info'), seg(` · ${m.name}`, 'ink')], [seg(lpad(kfmt(m.tokens), 5), 'sub')]))
  }
  const idle = idleMcp(b, life)
  if (idle.length) {
    out.push(gap, title('Loaded, never called', 'MCP server · tokens every request'))
    for (const r of idle.slice(0, 5)) out.push(leader(W, [seg(r.server, 'ink')], [seg(lpad(kfmt(r.tokens), 5), 'warn'), seg(`  ${r.sessions > 1 ? `${r.sessions} sessions` : 'this session'}`, 'faint')]))
  }
  const lc = b.lastCompact
  if (lc) {
    out.push(gap, title('Last compaction', `${dur(b.now - lc.at)} ago · ${lc.trigger}`))
    if (lc.before !== null && lc.after !== null) out.push(line(seg('  '), seg(kfmt(lc.before), 'warn'), seg(' ━━▶ ', 'faint'), seg(kfmt(lc.after), 'good'), seg(' tokens', 'sub')))
    out.push(plain(`  was feeding: ${lc.fed.length ? lc.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : 'no tool output recorded'}`, 'sub'))
  }
  return out
}

const spend = (b: Board, cfg: Cfg, life: Lifetime | null, W: number): Line[] => {
  const r = costRate(b)
  const left = budgetRunway(b, cfg)
  const out: Line[] = [
    title('Cost', left !== null ? `~${left} turns of budget left` : ''),
    line(
      seg('  '),
      pill(` ${money(b.ctx?.usd)} `, 'warn'),
      seg(`  this session${cfg.budgetUsd > 0 ? ` of ${money(cfg.budgetUsd)}` : ''}${r.perHour !== null ? ` · ${money(r.perHour)}/h` : ''}${r.perTurn !== null ? ` · ${money(r.perTurn)}/turn` : ''}${r.projected !== null ? ` · ~${money(r.projected)} in 10 turns` : ''}`, 'sub'),
    ),
  ]
  if (cfg.budgetUsd > 0) out.push(gauge(W, 'Budget', (b.ctx?.usd ?? 0) / cfg.budgetUsd, money(b.ctx?.usd)))
  if (cfg.turnBudgetUsd > 0) out.push(plain(`  turn-cost stop at ${money(cfg.turnBudgetUsd)} a turn`, 'faint'))
  const costed = b.turns.filter(t => t.usd !== null)
  out.push(...(costed.length ? trend(W, 'Per turn', costed.map(t => t.usd ?? 0), undefined, 'heat', `${costed.length} turns`) : [plain('  no costed turns yet', 'faint')]))
  const rows = modelSplit(b).slice(0, 5)
  out.push(gap, title('By model', 'share · turns · output · cost'))
  if (!rows.length) out.push(plain('  no finished turns yet', 'faint'))
  rows.forEach((m, i) =>
    out.push(line(seg(`  ${pad(short(m.model, 20), 20)} `, 'ink'), ...meter(m.share, Math.max(6, W - 50), (['warn', 'info', 'good', 'accent', 'sub'] as Tone[])[i] ?? 'info'), seg(` ${lpad(`${m.turns}t`, 4)} ${lpad(kfmt(m.output), 6)} `, 'sub'), seg(lpad(money(m.usd), 7), 'ink'))),
  )
  const alt = whatIf(b)
  if (alt.length) {
    out.push(gap, title('Same tokens, cheaper model', `list price · ${alt[0]?.turns} main-thread turns`))
    out.push(leader(W, [seg('as run', 'sub')], [seg(lpad(money(alt[0]?.actual), 7), 'ink'), seg(' '.repeat(10))]))
    for (const a of alt) out.push(leader(W, [seg(a.model, 'ink')], [seg(lpad(money(a.usd), 7), 'good'), seg(lpad(`-${Math.round((1 - a.usd / a.actual) * 100)}%`, 10), 'good')]))
  }
  const priciest = b.turns.filter(t => t.usd !== null && t.usd > 0).slice(-12).sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0)).slice(0, 3)
  if (priciest.length) {
    out.push(gap, title('Priciest turns', 'what fed them'))
    for (const t of priciest) out.push(line(seg(`  ${lpad(money(t.usd), 6)} `, 'warn'), seg(` ${lpad(dur(t.ms), 6)} · ${t.tools} tools · `, 'sub'), seg(short(t.fed?.length ? t.fed.map(f => `${f.name} ${kfmt(f.out)}`).join(' · ') : '–', W - 34), 'ink')))
  }
  if (life) {
    const days = lastDays(life, b.now, 30)
    const sum = days.reduce((s, d) => s + d.usd, 0)
    const today = days[days.length - 1]?.usd ?? 0
    const wk = weekCompare(life, b.now)
    out.push(
      gap,
      title('Last 30 days', `${money(sum)} · ${days.reduce((s, d) => s + d.turns, 0)} turns · ${days.filter(d => d.turns > 0).length} active days`),
      ...trend(W, 'Daily', days.map(d => d.usd), undefined, 'heat', `since ${days[0]?.key.slice(5) ?? ''}`),
      line(seg('  today      ', 'sub'), seg(money(today), cfg.dailyBudgetUsd > 0 && today >= cfg.dailyBudgetUsd ? 'bad' : 'warn'), seg(cfg.dailyBudgetUsd > 0 ? ` of ${money(cfg.dailyBudgetUsd)}` : '', 'sub')),
      line(
        seg('  last 7 days ', 'sub'),
        seg(money(wk.week), 'ink'),
        seg(wk.change !== null ? `  ${wk.change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(wk.change * 100))}% on the week before` : '', wk.change !== null && wk.change > 0.25 ? 'warn' : 'good'),
      ),
    )
    const branches = branchBoard(life).slice(0, 6)
    if (branches.length) {
      out.push(gap, title('By branch', 'all time · sessions · turns · cost'))
      for (const x of branches)
        out.push(leader(W, [seg(x.branch === b.branch ? '▸ ' : '  ', 'accent'), seg(x.branch, x.branch === b.branch ? 'accent' : 'ink')], [seg(`${lpad(`${x.sessions}s`, 4)} ${lpad(`${x.turns}t`, 5)} `, 'sub'), seg(lpad(money(x.usd), 7), 'warn')]))
    }
    const recent = (life.recent ?? []).slice(-6).reverse()
    if (recent.length) {
      out.push(gap, title('Recent sessions', 'grade · length · turns · cost'))
      for (const s of recent)
        out.push(
          line(
            seg(`  ${s.at === b.startedAt ? '▸' : ' '} `, 'accent'),
            pill(` ${s.grade} `, GRADE_TONE[s.grade] ?? 'info'),
            seg(`  ${dayKey(s.at).slice(5)} ${lpad(dur(s.ms), 6)} ${lpad(`${s.turns}t`, 4)} ${lpad(`${s.calls}c`, 5)} `, 'sub'),
            seg(lpad(money(s.usd), 7), 'ink'),
            seg(s.branch ? `  ${short(s.branch, Math.max(4, W - 44))}` : '', 'faint'),
          ),
        )
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
    out.push(
      line(
        seg(`  ${pad(short(r.tool, 14), 14)} `, 'ink'),
        ...meter(r.n / top, bw, r.okPct < 100 ? 'heat' : 'cool'),
        seg(` ${lpad(String(r.n), 4)} `, 'ink'),
        seg(lpad(`${r.okPct}%`, 4), r.okPct >= 95 ? 'good' : r.okPct >= 80 ? 'warn' : 'bad'),
        seg(` ${lpad(dur(r.avg), 6)} ${lpad(dur(r.p95), 6)}`, 'sub'),
      ),
    )
  const st = streaks(b)
  if (st.length) {
    out.push(gap, title('Failing in a row'))
    for (const s of st.slice(0, 4)) out.push(line(seg(`  ${pad(short(s.tool, 14), 14)} `, 'ink'), pill(` ${s.n}× `, 'bad'), seg(`  ${short(s.detail, W - 26)}`, 'sub')))
  }
  const runs = b.tests.slice(-5).reverse()
  if (runs.length) {
    out.push(gap, title('Test runs', b.tests.length > 1 ? `failing ${b.tests.slice(-6).map(t => t.fail).join(' → ')}` : ''))
    for (const t of runs)
      out.push(leader(W, [pill(t.fail ? ' FAIL ' : ' PASS ', t.fail ? 'bad' : 'good'), seg(`  ${t.cmd}`, 'ink')], [seg(lpad(`${t.pass} pass`, 9), 'good'), seg(lpad(`${t.fail} fail`, 8), t.fail ? 'bad' : 'faint'), seg(lpad(`${dur(b.now - t.at)} ago`, 11), 'faint')]))
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
      return leader(W, [changes ? heatCell('■', changes / top) : seg('□', 'faint'), seg(` ${shortPath(f.path, W)}`, changes ? 'ink' : 'sub')], [seg(`${lpad(String(f.edit), 3)} ${lpad(String(f.write), 3)} ${lpad(String(f.read), 3)}`, 'sub')])
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
    title('Subagent swimlanes', list.length ? `window ${dur(span)} · tools · tokens · time` : '', cfg.motion === 'smooth' && list.some(a => a.status === 'run') ? 'flow' : undefined),
    ...(list.length ? [] : [plain('  no subagents yet', 'faint')]),
    ...list.map(a => {
      const s = Math.min(lw - 1, Math.floor(((a.startedAt - t0) / span) * lw))
      const e = Math.min(lw, Math.max(s + 1, Math.ceil((((a.endedAt ?? b.now) - t0) / span) * lw)))
      return line(
        seg(`  ${pad(short(a.type, 14), 14)} `, 'ink'),
        seg('┈'.repeat(s), 'faint'),
        seg('━'.repeat(e - s), tone(a.status), a.status === 'run' && cfg.motion === 'smooth' ? 'flow' : undefined),
        seg(`${'┈'.repeat(lw - e)} `, 'faint'),
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
    gauge(W, 'Temp', v?.tempC != null ? v.tempC / (cfg.maxTempC + 15) : null, v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', `limit ${cfg.maxTempC}°`, 'heat', undefined, cfg.maxTempC / (cfg.maxTempC + 15)),
    gauge(
      W,
      v?.discharging ? 'Battery ↓' : 'Battery',
      v?.pct != null ? v.pct / 100 : null,
      v?.pct != null ? `${v.pct}%` : '–',
      `floor ${cfg.minBatteryPct}%`,
      'cool',
      undefined,
      cfg.minBatteryPct / 100,
      v?.pct == null ? 'faint' : v.pct > 50 ? 'good' : v.pct > cfg.minBatteryPct ? 'warn' : 'bad',
    ),
    gauge(W, 'Memory', v?.memPct != null ? v.memPct / 100 : null, v?.memPct != null ? `${v.memPct}%` : '–', cfg.maxMemPct > 0 ? `limit ${cfg.maxMemPct}%` : '', 'heat', undefined, cfg.maxMemPct > 0 ? cfg.maxMemPct / 100 : undefined),
    gauge(W, 'Load', v?.load1 != null ? v.load1 / th : null, v?.load1 != null ? v.load1.toFixed(1) : '–', `${th} threads`),
    gap,
    title('Thermal trend', `${peak !== null ? `peak ${peak}° · ` : ''}limit ${cfg.maxTempC}°`),
    ...trend(W, 'Temp', b.tempHist, Math.max(cfg.maxTempC + 10, ...b.tempHist), 'heat', v?.tempC != null ? `${Math.round(v.tempC)}°` : '–', false, Math.max(0, Math.min(...b.tempHist, cfg.maxTempC) - 10)),
    gap,
    title('Guardrails', cfg.guard ? 'heat guard armed' : 'heat guard off'),
    cfg.prefix
      ? gauge(W, `${short(cfg.prefix, 6)} prefix`, comp !== null ? comp / 100 : null, comp !== null ? `${comp}%` : '–', `of ${b.bash.total}`, 'cool', undefined, undefined, comp === null ? 'faint' : comp >= 90 ? 'good' : comp >= 60 ? 'warn' : 'bad')
      : plain('  prefix compliance off', 'faint'),
    line(seg('  gate  '), seg(`${b.gate.allow} allowed`, 'good'), seg('  ·  ', 'faint'), seg(`${b.gate.ask} asked`, 'info'), seg('  ·  ', 'faint'), seg(`${b.gate.deny} denied`, b.gate.deny ? 'bad' : 'sub')),
    line(seg('  held by guards  '), seg(`${b.guardBlocks} call${b.guardBlocks === 1 ? '' : 's'}`, b.guardBlocks ? 'bad' : 'good'), seg(`  ·  ${b.compactions} compactions`, 'sub')),
    plain(
      `  ${[cfg.pauseOnBattery ? 'pause on battery' : '', cfg.maxMemPct > 0 ? `memory ≤ ${cfg.maxMemPct}%` : '', cfg.turnBudgetUsd > 0 ? `turn ≤ ${money(cfg.turnBudgetUsd)}` : '', cfg.loopBreak ? 'loop breaker' : ''].filter(Boolean).join(' · ') || 'extra guards off'}`,
      'faint',
    ),
    ...jobLines(b, cfg, W),
  ]
}

const jobLines = (b: Board, cfg: Cfg, W: number): Line[] => {
  const list = b.jobs.slice(-6).reverse()
  if (!list.length) return []
  // A dev server runs for hours: its lines move only while a turn does, like the rest of the pane.
  const live = cfg.motion === 'smooth' && b.running
  return [
    gap,
    title('Background jobs', `${openJobs(b).length} running`, live && openJobs(b).length ? 'flow' : undefined),
    ...list.map(j =>
      leader(
        W,
        [seg(j.end === null ? '▸ ' : '□ ', j.end === null ? 'warn' : 'faint', j.end === null && live ? 'pulse' : undefined), seg(j.cmd, j.end === null ? 'ink' : 'sub')],
        [seg(lpad(j.end === null ? dur(b.now - j.at) : short(j.status, 9), 9), j.end === null ? 'warn' : 'faint')],
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

// The lines of one tab for a body `cols` wide (80 when unknown), titles ruled to the width and every line clipped
// to it. The log tab is the pane's own.
export const termPage = (tab: Tab, b: Board, cfg: Cfg, life: Lifetime | null, cols?: number): Line[] => {
  const W = width(cols)
  return (PAGES[tab]?.(b, cfg, life, W) ?? []).map(l => fit(ruled(l, W), W))
}

// The strip above the prompt, as one line.
export const termStrip = (b: Board, cfg: Cfg): Line => {
  const h = health(b, cfg)
  const c = b.ctx
  const v = b.vitals
  const live = cfg.motion === 'smooth' && b.running
  const ceiling = compactPct(b)
  const sep = seg('  ·  ', 'faint')
  const parts: Seg[][] = [
    [seg('◉ ', 'accent', live ? 'pulse' : undefined), pill(` ${h.grade} `, GRADE_TONE[h.grade] ?? 'info')],
    b.running ? [seg('⠋', 'warn', live ? 'spin' : undefined), seg(` ${dur(b.now - b.turnStart)}`, 'warn')] : [seg('◦ idle', 'faint')],
  ]
  if (c?.pct != null) parts.push([seg('ctx ', 'sub'), ...meter(c.pct / 100, 12, 'heat', live ? 'flow' : undefined, ceiling < 100 ? ceiling / 100 : undefined), seg(` ${Math.round(c.pct)}%`, level(c.pct / ceiling))])
  if (v?.tempC != null) parts.push([seg(`${Math.round(v.tempC)}°`, level(v.tempC / (cfg.maxTempC + 5)))])
  if (v?.pct != null) parts.push([seg(`bat ${v.pct}%${v.discharging ? '↓' : ''}`, v.discharging && v.pct < cfg.minBatteryPct ? 'bad' : 'sub')])
  if (c?.usd != null) parts.push([seg(money(c.usd), 'warn')])
  const w = cacheWarmth(b)
  if (w) parts.push([seg(cacheText(b), w.leftMs < 1000 ? 'faint' : w.leftMs <= 60_000 ? 'warn' : 'good')])
  return { segs: parts.flatMap((p, i) => (i ? [sep, ...p] : p)) }
}
