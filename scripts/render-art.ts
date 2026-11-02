// Renders the README art in docs/art/: hero plate, section plates, instrument cluster, spec sheet, sign-off.
// Usage: node scripts/render-art.ts [outdir]   (Node 22.18+ or 23.6+)
// Colours come from PALETTES in hooks/draw.ts, so the art and the pane stay one system.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const out = process.argv[2] ?? join(root, 'docs', 'art')
mkdirSync(out, { recursive: true })

const tmp = mkdtempSync(join(tmpdir(), 'embermeter-art-'))
for (const f of ['core.ts', 'draw.ts']) {
  writeFileSync(join(tmp, f), readFileSync(join(root, 'hooks', f), 'utf8').replace(/from '\.\/core'/g, "from './core.ts'"))
}
const { PALETTES } = await import(pathToFileURL(join(tmp, 'draw.ts')).href)
rmSync(tmp, { recursive: true, force: true })

const P = PALETTES.washi
const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif"
const SANS = "Inter, ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace"
const EASE = 'calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"'
const W = 880

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => Math.round(v * 100) / 100

type T = { size?: number; color?: string; font?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; ls?: number; attrs?: string; inner?: string }
const t = (x: number, y: number, s: string, o: T = {}) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="${o.font ?? SANS}" font-size="${o.size ?? 12}" fill="${o.color ?? P.sub}"` +
  (o.weight ? ` font-weight="${o.weight}"` : '') +
  (o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : '') +
  (o.italic ? ' font-style="italic"' : '') +
  (o.ls ? ` letter-spacing="${o.ls}"` : '') +
  (o.attrs ?? '') +
  `>${esc(s)}${o.inner ?? ''}</text>`

const pt = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = pt(cx, cy, r, a0)
  const [x1, y1] = pt(cx, cy, r, a1)
  return `M ${n(x0)} ${n(y0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${n(x1)} ${n(y1)}`
}
const deg = (f: number) => 150 + 240 * f

// ---------------------------------------------------------------- washi: paper, sun, ink, mist

// Paper: a slow mottle for the fibres and a fine grain on top, both from SVG noise, so no image is embedded.
const paper = (id: string, w: number, h: number) =>
  `<filter id="${id}-fibre" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.018" numOctaves="3" seed="11"/>` +
  `<feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0.22 0"/></filter>` +
  `<filter id="${id}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" stitchTiles="stitch"/>` +
  `<feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0.16 0"/></filter>` +
  `<radialGradient id="${id}-vignette" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#7a6648" stop-opacity="0"/><stop offset="1" stop-color="#7a6648" stop-opacity="0.16"/></radialGradient>`

// The vermilion sun: lighter towards the lower right, as ink pooled on the paper, with its own speckle.
const sunDefs = (id: string) =>
  `<radialGradient id="${id}-sun" cx="0.62" cy="0.7" r="0.75"><stop offset="0" stop-color="#e0574a"/><stop offset="0.65" stop-color="${P.amber}"/><stop offset="1" stop-color="#b93127"/></radialGradient>` +
  `<filter id="${id}-speckle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="9"/>` +
  `<feColorMatrix values="0 0 0 0 0.95  0 0 0 0 0.88  0 0 0 0 0.8  0 0 0 0.16 -0.03"/></filter>`

const sun = (id: string, cx: number, cy: number, r: number) =>
  `<clipPath id="${id}-sunclip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>` +
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-sun)"/>` +
  `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" filter="url(#${id}-speckle)" clip-path="url(#${id}-sunclip)"/>`

// Ink fading into mist: sumi at the peak, gone by the foot.
const inkDefs = (id: string) =>
  `<linearGradient id="${id}-ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.ink}"/><stop offset="0.55" stop-color="#3b3f40" stop-opacity="0.9"/><stop offset="1" stop-color="#5b5d5a" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="${id}-redface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P.amber}" stop-opacity="0.85"/><stop offset="1" stop-color="${P.amber}" stop-opacity="0"/></linearGradient>` +
  `<filter id="${id}-mist" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="9"/></filter>` +
''

// Deterministic jitter in -1..1, so a ridge looks hand-drawn but renders the same every time.
const jitter = (i: number, seed: number) => {
  const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
  return (v - Math.floor(v)) * 2 - 1
}

// Points from a to b (a excluded), nudged up and down like a brushed ridge line.
const slope = (a: [number, number], b: [number, number], steps: number, amp: number, seed: number): [number, number][] =>
  Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / steps
    const y = a[1] + (b[1] - a[1]) * f
    return [a[0] + (b[0] - a[0]) * f, i === steps - 1 ? y : y + amp * jitter(i, seed)] as [number, number]
  })

// A peak in sumi: a paler peak behind, the main ridge fading into mist, its sunlit face washed in vermilion and kept
// inside the outline, a few dry-brush gullies, and mist drifting across the foot. Units: 280 wide, 124 high.
const mountain = (id: string, x: number, base: number, s: number) => {
  const X = (v: number) => n(x + v * s)
  const Y = (v: number) => n(base - v * s)
  const path = (pts: [number, number][]) => `M ${pts.map(([px, py]) => `${X(px)} ${Y(py)}`).join(' L ')} Z`
  const apex: [number, number] = [100, 124]
  const main: [number, number][] = [
    [-34, 0],
    ...slope([-34, 0], [38, 56], 6, 2.5, 1),
    ...slope([38, 56], apex, 7, 2.2, 2),
    ...slope(apex, [148, 72], 6, 2.2, 3),
    ...slope([148, 72], [170, 60], 2, 1.5, 4),
    ...slope([170, 60], [212, 26], 5, 2, 5),
    ...slope([212, 26], [262, 0], 4, 1.5, 6),
  ]
  const back: [number, number][] = [[150, 0], ...slope([150, 0], [206, 86], 6, 2, 7), ...slope([206, 86], [286, 0], 7, 2, 8)]
  const right = main.filter(([px, py]) => px >= apex[0] && py > 0)
  const face: [number, number][] = [...right, [176, 8], [140, 30], [116, 70]]
  const gully = (pts: [number, number][], o: number) =>
    `<path d="M ${pts.map(([px, py]) => `${X(px)} ${Y(py)}`).join(' L ')}" fill="none" stroke="${P.ink}" stroke-opacity="${o}" stroke-width="${n(0.9 * s)}" stroke-linecap="round"/>`
  return (
    `<clipPath id="${id}-peak"><path d="${path(main)}"/></clipPath>` +
    `<path d="${path(back)}" fill="url(#${id}-redface)" opacity="0.42"/>` +
    `<path d="${path(back)}" fill="url(#${id}-ink)" opacity="0.28"/>` +
    `<path d="${path(main)}" fill="url(#${id}-ink)"/>` +
    `<g clip-path="url(#${id}-peak)">` +
    `<path d="${path(face)}" fill="url(#${id}-redface)"/>` +
    gully([[100, 120], [96, 96], [86, 74], [80, 48]], 0.35) +
    gully([[104, 116], [112, 92], [118, 70]], 0.3) +
    gully([[70, 70], [62, 46], [58, 24]], 0.22) +
    gully([[160, 60], [150, 40], [146, 20]], 0.2) +
    `</g>` +
    `<ellipse cx="${X(110)}" cy="${Y(4)}" rx="${n(170 * s)}" ry="${n(20 * s)}" fill="${P.ground}" filter="url(#${id}-mist)" opacity="0.95">` +
    `<animate attributeName="cx" values="${X(98)};${X(124)};${X(98)}" dur="14s" repeatDur="20s" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/></ellipse>`
  )
}

// A bird in sumi: wings beat, and the flock drifts.
const bird = (x: number, y: number, s: number, phase: number) =>
  `<g transform="translate(${n(x)} ${n(y)}) scale(${s})"><path d="M -9 -1 Q -5 -6 0 0 Q 5 -6 9 -1 Q 5 -2.5 0 2.2 Q -5 -2.5 -9 -1 Z" fill="${P.ink}">` +
  `<animateTransform attributeName="transform" type="scale" values="1 1;1 0.35;1 1" dur="0.95s" begin="-${n(phase)}s" repeatDur="20s"/></path></g>`

const flock = (pts: [number, number, number][], dx: number, dy: number, dur: number) =>
  `<g><animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy};0 0" dur="${dur}s" repeatDur="20s" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>` +
  pts.map(([x, y, s], i) => bird(x, y, s, i * 0.31)).join('') +
  `</g>`

// A hanko seal: a red stamp, slightly askew, with the letters in paper.
const seal = (x: number, y: number, size: number, text: string) =>
  `<g transform="rotate(-4 ${n(x + size / 2)} ${n(y + size / 2)})"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill="${P.amber}" opacity="0.92"/>` +
  `<rect x="${x + 3}" y="${y + 3}" width="${size - 6}" height="${size - 6}" rx="2.5" fill="none" stroke="${P.panel}" stroke-width="1.2" opacity="0.85"/>` +
  t(x + size / 2, y + size / 2 + size * 0.15, text, { font: SERIF, size: size * 0.42, weight: 700, color: P.panel, anchor: 'middle' }) +
  `</g>`

// A plate of washi: mottled paper, a hairline frame and a fine inner rule.
const plate = (w: number, h: number, body: string, label: string, id: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">` +
  `<defs>${paper(id, w, h)}<clipPath id="${id}-clip"><rect width="${w}" height="${h}" rx="14"/></clipPath>${defs}</defs>` +
  `<g clip-path="url(#${id}-clip)"><rect width="${w}" height="${h}" fill="${P.ground}"/>` +
  `<rect width="${w}" height="${h}" filter="url(#${id}-fibre)"/><rect width="${w}" height="${h}" filter="url(#${id}-grain)"/>` +
  `<rect width="${w}" height="${h}" fill="url(#${id}-vignette)"/>` +
  body +
  `</g>` +
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="13.5" fill="none" stroke="${P.line}"/>` +
  `<rect x="7.5" y="7.5" width="${w - 15}" height="${h - 15}" rx="9" fill="none" stroke="${P.ink}" stroke-opacity="0.12"/>` +
  `</svg>`

// ---------------------------------------------------------------- hero

// A ridge line in ink: points across, closed to the foot, faded by its own gradient.
const ridge = (pts: [number, number][], foot: number, fill: string, opacity: number) =>
  `<path d="M ${n(pts[0]![0])} ${foot} ${pts.map(([x, y]) => `L ${n(x)} ${n(y)}`).join(' ')} L ${n(pts[pts.length - 1]![0])} ${foot} Z" fill="${fill}" opacity="${opacity}"/>`

// A band of mist that drifts sideways and back.
const mistBand = (id: string, cx: number, cy: number, rx: number, ry: number, dx: number, dur: number, o = 0.9) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${P.ground}" filter="url(#${id}-mist)" opacity="${o}">` +
  `<animate attributeName="cx" values="${cx};${cx + dx};${cx}" dur="${dur}s" repeatDur="20s" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/></ellipse>`

// A tapered brush stroke, thick in the middle and dry at both ends.
const brushStroke = (x: number, y: number, w: number, h: number, color: string) =>
  `<path d="M ${x} ${y} C ${n(x + w * 0.25)} ${n(y - h)} ${n(x + w * 0.7)} ${n(y - h * 0.9)} ${x + w} ${n(y - h * 0.15)} C ${n(x + w * 0.7)} ${n(y + h * 0.35)} ${n(x + w * 0.3)} ${n(y + h * 0.45)} ${x} ${y} Z" fill="${color}"/>`

const hero = () => {
  const H = 440
  const cx = 632
  const cy = 176
  const r = 100
  const f = 0.62
  const lake = 318
  let g = ''

  // Mounting: ink corner brackets, as on a hanging scroll.
  const k = 18
  for (const [x, y, sx, sy] of [
    [22, 22, 1, 1],
    [W - 22, 22, -1, 1],
    [22, H - 22, 1, -1],
    [W - 22, H - 22, -1, -1],
  ] as const) {
    g += `<path d="M ${x} ${y + sy * k} L ${x} ${y} L ${x + sx * k} ${y}" fill="none" stroke="${P.ink}" stroke-opacity="0.55" stroke-width="1.4"/>`
  }

  // The sun bleeds a little into the paper, as watercolour does.
  // A soft halo, as watercolour spreads into the paper. Gradients only: filters that move pixels get cropped in Chrome.
  g += `<circle cx="${cx}" cy="${cy}" r="${r + 30}" fill="url(#hero-halo)"/>`
  g += sun('hero', cx, cy, r)

  // The dial: a fine ring of ticks with numerals, a crimson red line, and a pointer that settles on the reading.
  for (let i = 0; i <= 40; i++) {
    const a = deg(i / 40)
    const major = i % 10 === 0
    const mid = i % 5 === 0
    const [x0, y0] = pt(cx, cy, r + 14, a)
    const [x1, y1] = pt(cx, cy, r + (major ? 25 : mid ? 21 : 18), a)
    g += `<line x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}" stroke="${P.ink}" stroke-opacity="${major ? 0.75 : mid ? 0.5 : 0.28}" stroke-width="${major ? 1.4 : 0.9}" stroke-linecap="round"/>`
    if (major) {
      const [lx, ly] = pt(cx, cy, r + 36, a)
      g += t(lx, ly + 3, String(i * 2.5), { font: MONO, size: 8, color: P.faint, anchor: 'middle' })
    }
  }
  g += `<path d="${arc(cx, cy, r + 19, deg(0.85), deg(1))}" fill="none" stroke="${P.rust}" stroke-width="3" stroke-linecap="round"/>`
  const end = deg(f)
  const [px, py] = pt(cx, cy, r + 9, 0)
  g +=
    `<g transform="rotate(${n(end)} ${cx} ${cy})"><animateTransform attributeName="transform" type="rotate" values="150 ${cx} ${cy};${n(end + 8)} ${cx} ${cy};${n(end - 3)} ${cx} ${cy};${n(end)} ${cx} ${cy}" keyTimes="0;0.6;0.82;1" dur="2.4s" fill="freeze"/>` +
    `<path d="M ${n(px)} ${n(py)} l 13 -5.5 l 0 11 Z" fill="${P.ink}"/></g>`

  // Embers lift off the sun and fade.
  const sparks: [number, number, number, number][] = [
    [cx - 46, 2.6, 0, 5.2],
    [cx + 8, 2, 1.4, 6],
    [cx + 52, 2.4, 2.6, 5.6],
    [cx - 14, 1.8, 3.6, 6.4],
    [cx + 34, 1.6, 4.4, 5],
  ]
  for (const [x, rr, begin, dur] of sparks) {
    g +=
      `<circle cx="${x}" cy="${cy - r * 0.55}" r="${rr}" fill="${P.amber}" opacity="0">` +
      `<animate attributeName="cy" values="${cy - r * 0.55};${cy - r - 46}" dur="${dur}s" begin="${begin}s" repeatDur="20s"/>` +
      `<animate attributeName="cx" values="${x};${x + 9};${x - 5}" dur="${dur}s" begin="${begin}s" repeatDur="20s"/>` +
      `<animate attributeName="opacity" values="0;0.9;0" keyTimes="0;0.25;1" dur="${dur}s" begin="${begin}s" repeatDur="20s"/></circle>`
  }

  // Three ranges, each paler with distance, with mist between them; the whole landscape dissolves into the paper at its edges.
  g += `<g mask="url(#hero-land)">`
  g += ridge([[388, 262], [430, 238], [468, 250], [512, 226], [560, 246], [610, 230], [660, 244], [712, 220], [760, 240], [812, 228], [858, 246]], lake, P.steel, 0.16)
  g += mistBand('hero', 600, 262, 260, 14, 30, 16, 0.85)
  g += ridge([[396, 300], [446, 268], [490, 280], [540, 252], [580, 270], [632, 262], [690, 276], [736, 250], [790, 272], [858, 262]], lake, P.ink, 0.3)
  g += mistBand('hero', 690, 292, 220, 12, -26, 13, 0.8)
  g += mountain('hero', cx - 136, lake, 1.2)

  // The lake: still water, and the sun's reflection broken into shimmering strokes.
  g += `<rect x="380" y="${lake}" width="${W - 380}" height="${H - 92 - lake}" fill="url(#hero-water)"/>`
  ;[
    [lake + 7, 86, 0],
    [lake + 14, 64, 0.5],
    [lake + 21, 48, 1],
    [lake + 28, 30, 1.5],
    [lake + 34, 18, 2],
  ].forEach(([y, w, d]) => {
    g +=
      `<rect x="${n(cx - w! / 2)}" y="${y}" width="${w}" height="2.2" rx="1.1" fill="${P.amber}" opacity="0.55">` +
      `<animate attributeName="x" values="${n(cx - w! / 2)};${n(cx - w! / 2 + 5)};${n(cx - w! / 2 - 3)};${n(cx - w! / 2)}" dur="4.2s" begin="-${d}s" repeatDur="20s"/>` +
      `<animate attributeName="opacity" values="0.55;0.25;0.55" dur="3.1s" begin="-${d}s" repeatDur="20s"/></rect>`
  })
  g += `<line x1="380" y1="${lake}" x2="${W - 34}" y2="${lake}" stroke="${P.ink}" stroke-opacity="0.18"/>`
  g += `</g>`

  g += flock(
    [
      [cx + 30, cy - 58, 1],
      [cx + 60, cy - 72, 0.9],
      [cx + 52, cy - 38, 0.95],
      [cx - 6, cy - 6, 0.82],
      [cx + 98, cy - 50, 0.7],
    ],
    -14,
    -6,
    11,
  )

  // A vertical caption down the right margin, as on a scroll.
  g += t(0, 0, 'EMBERMETER · MODEL EM-1 · NO. 0001', { font: MONO, size: 8.5, color: P.faint, ls: 3, attrs: ` transform="translate(${W - 40} 70) rotate(90)"` })

  // Kicker, wordmark, brush stroke, seal and tagline.
  g += t(58, 78, 'OPERATOR’S MANUAL', { font: MONO, size: 9.5, color: P.amber, ls: 4 })
  g += `<line x1="58" y1="90" x2="98" y2="90" stroke="${P.amber}" stroke-width="1.2"/>`
  g += t(54, 160, 'Embermeter', { font: SERIF, size: 70, color: P.ink, ls: -1.5 })
  g += brushStroke(58, 184, 230, 7, P.amber)
  g += seal(440, 98, 40, 'EM')
  g += t(58, 218, 'a live instrument panel for Claude Code', { font: SERIF, size: 18, italic: true, color: P.sub })

  // Readouts on rice paper: a caption, a live dot, and a value that ticks like a display.
  const readout = (x: number, cap: string, values: string[]) => {
    let s = `<rect x="${x}" y="246" width="104" height="58" rx="3" fill="${P.panel}" fill-opacity="0.55"/>`
    s += `<line x1="${x}" y1="246" x2="${x + 104}" y2="246" stroke="${P.ink}" stroke-opacity="0.6" stroke-width="1.2"/>`
    s += t(x + 10, 264, cap, { font: MONO, size: 8, color: P.faint, ls: 2 })
    s += `<circle cx="${x + 95}" cy="261" r="2.6" fill="${P.amber}"><animate attributeName="opacity" values="1;0.25;1" dur="1.8s" repeatDur="20s"/></circle>`
    const k2 = values.length
    values.forEach((v, i) => {
      const vals = values.map((_, j) => (j === i ? 1 : 0)).join(';') + `;${i === 0 ? 1 : 0}`
      const times = values.map((_, j) => n(j / k2)).join(';') + ';1'
      s += t(x + 10, 290, v, {
        font: MONO,
        size: 18,
        weight: 600,
        color: P.ink,
        attrs: ` opacity="${i === 0 ? 1 : 0}"`,
        inner: `<animate attributeName="opacity" values="${vals}" keyTimes="${times}" calcMode="discrete" dur="${k2 * 1.7}s" repeatDur="20s"/>`,
      })
    })
    return s
  }
  g += readout(58, 'RUNWAY', ['9 turns', '8 turns'])
  g += readout(174, 'CACHE HIT', ['89%', '90%', '89%', '91%'])
  g += readout(290, 'SPEND', ['$2.41', '$2.44', '$2.47'])

  // Ticker tape between two ink rules, with vermilion stops.
  const items = [
    'turn 14 · 2.1k out · 38s',
    'Bash npm test ✓ 18.4s',
    'Edit src/lib/http.ts',
    'Explore agent done · 23 tools',
    'context +4% · runway 9 turns',
    'loop watch quiet',
    'cpu 68° · guard armed',
    'cost $2.41 · $3.08/h',
    'Read fed 11k tokens',
    'rate limit 5h · 46%',
  ]
  const sep = ' ● '
  const chars = items.join(sep).length + sep.length
  const Lt = n(chars * 6.6)
  const tape = items.map(s => `<tspan fill="${P.sub}">${esc(s)}</tspan><tspan fill="${P.amber}">${sep}</tspan>`).join('')
  const ty = H - 72
  g += `<defs><clipPath id="tape"><rect x="58" y="${ty}" width="${W - 116}" height="28"/></clipPath>`
  g += `<linearGradient id="tapefade" x1="0" x2="1"><stop offset="0" stop-color="${P.ground}"/><stop offset="0.06" stop-color="${P.ground}" stop-opacity="0"/><stop offset="0.94" stop-color="${P.ground}" stop-opacity="0"/><stop offset="1" stop-color="${P.ground}"/></linearGradient></defs>`
  g += `<line x1="58" y1="${ty}" x2="${W - 58}" y2="${ty}" stroke="${P.ink}" stroke-opacity="0.3"/><line x1="58" y1="${ty + 3}" x2="${W - 58}" y2="${ty + 3}" stroke="${P.ink}" stroke-opacity="0.12"/>`
  g += `<line x1="58" y1="${ty + 28}" x2="${W - 58}" y2="${ty + 28}" stroke="${P.ink}" stroke-opacity="0.3"/>`
  g +=
    `<g clip-path="url(#tape)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="-${Lt} 0" dur="${n(Lt / 34)}s" repeatDur="20s"/>` +
    `<text x="58" y="${ty + 19}" font-family="${MONO}" font-size="11" textLength="${n(Lt * 2)}" lengthAdjust="spacing" xml:space="preserve">${tape}${tape}</text></g>` +
    `<rect x="58" y="${ty}" width="${W - 116}" height="28" fill="url(#tapefade)"/></g>`
  g += t(58, H - 28, 'No. 0001', { font: MONO, size: 8.5, color: P.faint, ls: 2 })
  g += t(W - 58, H - 28, 'MIT · LOCAL ONLY · NO NETWORK', { font: MONO, size: 8.5, color: P.faint, ls: 2, anchor: 'end' })

  const extra =
    `<radialGradient id="hero-halo"><stop offset="0.72" stop-color="${P.amber}" stop-opacity="0.16"/><stop offset="1" stop-color="${P.amber}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="hero-landfade" x1="380" x2="${W - 50}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.22" stop-color="#fff"/><stop offset="0.86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="hero-land" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#hero-landfade)"/></mask>` +
    `<linearGradient id="hero-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.steel}" stop-opacity="0.10"/><stop offset="1" stop-color="${P.steel}" stop-opacity="0"/></linearGradient>`
  return plate(W, H, g, 'Embermeter, model EM-1: a live instrument panel for Claude Code', 'hero', sunDefs('hero') + inkDefs('hero') + extra)
}

// ---------------------------------------------------------------- section plates

const SECTIONS = [
  ['install', 'I', 'Installation', 'fig. 1 · one command'],
  ['instruments', 'II', 'The Instruments', 'fig. 2 · sixteen gauges'],
  ['tour', 'III', 'A Tour of the Panel', 'fig. 3 · eight tabs'],
  ['controls', 'IV', 'Controls', 'fig. 4 · commands & settings'],
  ['workings', 'V', 'Inner Workings', 'fig. 5 · architecture'],
  ['safety', 'VI', 'Safety Notice', 'fig. 6 · privacy & security'],
  ['notes', 'VII', 'Field Notes', 'fig. 7 · questions'],
  ['bench', 'VIII', 'The Workbench', 'fig. 8 · contributing'],
] as const

// An ensō, the brushed circle, closes a little more with each section, so the README reads like a gauge filling up.
const section = (i: number) => {
  const [, num, title, cap] = SECTIONS[i]!
  const f = (i + 1) / SECTIONS.length
  const cx = 52
  const cy = 40
  const r = 20
  const C = n(2 * Math.PI * r)
  const brush = (w: number, o: number, rot: number, len: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${P.ink}" stroke-width="${w}" stroke-opacity="${o}" stroke-linecap="round" stroke-dasharray="${n(len)} ${C}" transform="rotate(${rot} ${cx} ${cy})">` +
    `<animate attributeName="stroke-dasharray" from="0 ${C}" to="${n(len)} ${C}" dur="1.6s" ${EASE} fill="freeze"/></circle>`
  let g = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${P.ink}" stroke-opacity="0.08" stroke-width="5"/>`
  g += brush(5, 0.85, -100, C * f * 0.94) + brush(2, 0.35, -96, C * f * 0.9)
  g += `<circle cx="${cx}" cy="${cy}" r="${n(5 + 4 * f)}" fill="${P.amber}" opacity="0.9"/>`
  g += t(94, 31, num, { font: SERIF, size: 12, color: P.amber, ls: 3 })
  g += t(94, 57, title, { font: SERIF, size: 26, color: P.ink })
  const titleEnd = 94 + title.length * 13.4
  const capW = cap.length * 6.1
  g += `<line x1="${n(titleEnd + 18)}" y1="53" x2="${n(W - 34 - capW - 14)}" y2="53" stroke="${P.ink}" stroke-opacity="0.35" stroke-width="1.2" stroke-dasharray="1 5" stroke-linecap="round"/>`
  g += t(W - 34, 57, cap, { font: MONO, size: 10, color: P.faint, anchor: 'end' })
  return plate(W, 80, g, `${num}. ${title}`, `s${i}`)
}

// ---------------------------------------------------------------- instrument cluster

type Tile = { title: string; lines: [string, string]; glyph: () => string }
const bar = (x: number, y: number, w: number, h: number, c: string, o = 1) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="${Math.min(2, h / 2)}" fill="${c}" opacity="${o}"/>`

const TILES: Tile[] = [
  {
    title: 'Runway to compact',
    lines: ['Turns left before auto-', 'compact, learned per turn.'],
    glyph: () =>
      `<path d="M 30 62 L 62 18 M 120 62 L 88 18" stroke="${P.sub}" stroke-width="1.4"/>` +
      `<line x1="75" y1="62" x2="75" y2="18" stroke="${P.amber}" stroke-width="2" stroke-dasharray="6 6"><animate attributeName="stroke-dashoffset" from="0" to="12" dur="0.8s" repeatDur="20s"/></line>` +
      t(148, 50, '9', { font: MONO, size: 30, weight: 600, color: P.amber }) +
      t(170, 50, 'turns', { size: 10, color: P.faint }),
  },
  {
    title: 'Context composition',
    lines: ['What fills the window, with', 'the compaction line marked.'],
    glyph: () => {
      const segs: [number, string][] = [
        [0.39, P.amber],
        [0.09, P.steel],
        [0.05, P.sage],
        [0.03, P.sand],
        [0.02, P.rose],
      ]
      let x = 16
      let s = bar(16, 34, 168, 14, P.line)
      segs.forEach(([w, c], i) => {
        s += `<rect x="${n(x)}" y="34" width="${n(w * 168)}" height="14" fill="${c}"><animate attributeName="width" from="0" to="${n(w * 168)}" dur="0.6s" begin="${i * 0.15}s" ${EASE} fill="freeze"/></rect>`
        x += w * 168
      })
      return s + `<line x1="${n(16 + 0.83 * 168)}" y1="26" x2="${n(16 + 0.83 * 168)}" y2="56" stroke="${P.rust}" stroke-width="2"/>` + t(n(16 + 0.83 * 168), 22, 'compact', { size: 8.5, color: P.rust, anchor: 'middle' })
    },
  },
  {
    title: 'Health grade',
    lines: ['One A–F score, with the', 'reasons spelled out.'],
    glyph: () =>
      `<rect x="16" y="16" width="44" height="44" rx="10" fill="none" stroke="${P.sage}" stroke-width="1.6"/>` +
      t(38, 47, 'A', { font: MONO, size: 24, weight: 700, color: P.sage, anchor: 'middle' }) +
      t(74, 34, '96 / 100', { font: MONO, size: 11, color: P.ink }) +
      t(74, 50, 'all clear', { size: 10, color: P.faint }),
  },
  {
    title: 'Cache analytics',
    lines: ['Hit rate, cache reads and', 'writes, tokens per second.'],
    glyph: () => {
      const C = n(2 * Math.PI * 20)
      return (
        `<circle cx="40" cy="39" r="20" fill="none" stroke="${P.line}" stroke-width="6"/>` +
        `<circle cx="40" cy="39" r="20" fill="none" stroke="${P.sage}" stroke-width="6" stroke-dasharray="${n(C * 0.89)} ${C}" transform="rotate(-90 40 39)"><animate attributeName="stroke-dasharray" from="0 ${C}" to="${n(C * 0.89)} ${C}" dur="1.2s" ${EASE} fill="freeze"/></circle>` +
        t(76, 36, '89% hit', { font: MONO, size: 12, color: P.ink }) +
        t(76, 52, '62 tok/s', { font: MONO, size: 10, color: P.faint })
      )
    },
  },
  {
    title: 'Cost burn',
    lines: ['Per hour, per turn, and a', 'budget with a red line.'],
    glyph: () =>
      `<line x1="16" y1="22" x2="184" y2="22" stroke="${P.rust}" stroke-width="1.4" stroke-dasharray="4 4"/>` +
      t(184, 17, 'budget', { size: 8.5, color: P.rust, anchor: 'end' }) +
      `<polyline points="16,58 40,54 64,50 88,47 112,40 136,37 160,31 184,28" fill="none" stroke="${P.amber}" stroke-width="2" stroke-linejoin="round" stroke-dasharray="190" stroke-dashoffset="0"><animate attributeName="stroke-dashoffset" from="190" to="0" dur="1.4s" ${EASE} fill="freeze"/></polyline>`,
  },
  {
    title: 'Rate limits',
    lines: ['Every window, how full,', 'and when it resets.'],
    glyph: () =>
      t(16, 30, '5h', { font: MONO, size: 10, color: P.faint }) +
      bar(40, 22, 144, 8, P.line) +
      bar(40, 22, 144 * 0.46, 8, P.amber) +
      t(16, 52, '7d', { font: MONO, size: 10, color: P.faint }) +
      bar(40, 44, 144, 8, P.line) +
      bar(40, 44, 144 * 0.21, 8, P.steel) +
      t(184, 66, 'resets 2h 24m', { font: MONO, size: 8.5, color: P.faint, anchor: 'end' }),
  },
  {
    title: 'Live flow',
    lines: ['Particles move only where', 'work is happening.'],
    glyph: () => {
      const xs = [24, 74, 124, 174]
      let s = `<path d="M 24 40 L 174 40" stroke="${P.line}" stroke-width="1.4"/>`
      xs.forEach((x, i) => (s += `<circle cx="${x}" cy="40" r="7" fill="${P.panel}" stroke="${i === 3 ? P.amber : P.sub}" stroke-width="1.4"/>`))
      for (let k = 0; k < 3; k++) {
        s += `<circle r="2.6" fill="${P.amber}"><animateMotion path="M 24 40 L 174 40" dur="1.8s" begin="-${n(k * 0.6)}s" repeatDur="20s" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.55 1"/></circle>`
      }
      return s + ['prompt', 'model', 'gate', 'tools'].map((l, i) => t(xs[i]!, 64, l, { size: 8.5, color: P.faint, anchor: 'middle' })).join('')
    },
  },
  {
    title: 'Tool leaderboard',
    lines: ['Calls, failures, avg and', 'p95 for every tool.'],
    glyph: () =>
      [1, 0.74, 0.52, 0.31]
        .map((w, i) => {
          const y = 18 + i * 12
          return bar(16, y, 168 * w * 0.9, 7, P.sage, 0.85) + bar(16 + 168 * w * 0.9, y, 168 * w * 0.1, 7, P.rust, 0.9)
        })
        .join(''),
  },
  {
    title: 'File heatmap',
    lines: ['Every file touched, tinted', 'by how much it changed.'],
    glyph: () => {
      const heat = [0.9, 0.2, 0.5, 0.1, 0.7, 0.3, 0.15, 0.6, 0.25, 0.8, 0.1, 0.45, 0.2, 0.35, 0.95, 0.1, 0.5, 0.2, 0.7, 0.3, 0.1, 0.55, 0.15, 0.4]
      return heat.map((h, i) => `<rect x="${16 + (i % 8) * 21}" y="${16 + Math.floor(i / 8) * 15}" width="18" height="12" rx="2" fill="${P.amber}" opacity="${n(0.1 + h * 0.85)}"/>`).join('')
    },
  },
  {
    title: 'Subagent swimlanes',
    lines: ['Each agent on a timeline;', 'click to open its transcript.'],
    glyph: () =>
      [
        [16, 52, P.sage],
        [56, 70, P.steel],
        [110, 74, P.amber],
      ]
        .map(([x, w, c], i) => {
          const y = 18 + i * 15
          const grow = i === 2 ? `<animate attributeName="width" values="20;${w};${w}" keyTimes="0;0.8;1" dur="3s" repeatDur="20s"/>` : ''
          return `<line x1="16" y1="${y + 4}" x2="184" y2="${y + 4}" stroke="${P.grid}"/><rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="${c}">${grow}</rect>`
        })
        .join(''),
  },
  {
    title: 'Heat guard',
    lines: ['Holds heavy jobs while the', 'CPU runs hot.'],
    glyph: () =>
      `<g transform="translate(40 40)"><path d="M 0 -22 C 10 -10 16 -2 12 10 C 9 19 -9 19 -12 10 C -15 1 -8 -6 -4 -12 C -3 -6 0 -3 3 -4 C 4 -10 2 -16 0 -22 Z" fill="${P.amber}"><animateTransform attributeName="transform" type="scale" values="1 1;1.04 0.96;0.97 1.05;1 1" dur="1.3s" repeatDur="20s"/></path>` +
      `<path d="M 0 2 C 4 6 5 9 3 13 C 1 16 -3 16 -4 13 C -5 9 -2 6 0 2 Z" fill="${P.ground}" opacity="0.55"/></g>` +
      `<line x1="76" y1="28" x2="184" y2="28" stroke="${P.rust}" stroke-width="1.4"/>` +
      t(184, 22, 'limit 80°', { font: MONO, size: 8.5, color: P.rust, anchor: 'end' }) +
      t(76, 52, 'build · held', { font: MONO, size: 10, color: P.sub }),
  },
  {
    title: 'Session report',
    lines: ['One click to Markdown,', 'plus lifetime totals.'],
    glyph: () =>
      `<path d="M 20 14 H 52 L 62 24 V 64 H 20 Z" fill="${P.panel}" stroke="${P.sub}" stroke-width="1.3"/><path d="M 52 14 V 24 H 62" fill="none" stroke="${P.sub}" stroke-width="1.3"/>` +
      [30, 38, 46, 54].map((y, i) => bar(27, y, i === 0 ? 18 : 28 - i * 3, 2.5, i === 0 ? P.amber : P.faint)).join('') +
      t(76, 36, '# Session report', { font: MONO, size: 10, color: P.ink }) +
      t(76, 52, '| Bash | 4 | 75% |', { font: MONO, size: 10, color: P.faint }),
  },
  {
    title: 'Loop watch',
    lines: ['Spots the same call again', 'and again, and says so.'],
    glyph: () =>
      `<g transform="translate(40 38)"><circle r="17" fill="none" stroke="${P.line}" stroke-width="5"/>` +
      `<circle r="17" fill="none" stroke="${P.amber}" stroke-width="5" stroke-linecap="round" stroke-dasharray="40 67"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.6s" repeatDur="20s"/></circle></g>` +
      t(74, 34, 'npm test ×3', { font: MONO, size: 11, color: P.ink }) +
      t(74, 50, 'may be looping', { size: 10, color: P.rust }),
  },
  {
    title: 'Context fed by tools',
    lines: ['Which tool results eat', 'the window, ranked.'],
    glyph: () =>
      [
        ['Read', 1, P.amber],
        ['Bash', 0.56, P.steel],
        ['Web', 0.47, P.steel],
      ]
        .map(([name, w, c], i) => {
          const y = 18 + i * 15
          return (
            t(16, y + 7, String(name), { font: MONO, size: 9, color: P.faint }) +
            bar(52, y, 132, 6, P.line) +
            `<rect x="52" y="${y}" width="${n(132 * Number(w))}" height="6" rx="2" fill="${c}"><animate attributeName="width" from="0" to="${n(132 * Number(w))}" dur="0.9s" begin="${i * 0.2}s" ${EASE} fill="freeze"/></rect>`
          )
        })
        .join(''),
  },
  {
    title: 'Cost waterfall',
    lines: ['Every turn stacked on the', 'total, by model too.'],
    glyph: () => {
      const steps = [6, 3, 9, 4, 12, 5, 7]
      let cum = 0
      let s = `<line x1="16" y1="62" x2="184" y2="62" stroke="${P.line}"/>`
      steps.forEach((h, i) => {
        const y = 62 - cum - h
        s += `<rect x="${16 + i * 24}" y="${y}" width="18" height="${h}" rx="1.5" fill="${i === 4 ? P.amber : P.sage}" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${n(i * 0.18)}s" fill="freeze"/></rect>`
        cum += h
      })
      return s
    },
  },
  {
    title: 'Thirty days',
    lines: ['A calendar of spend, from', 'totals kept on your machine.'],
    glyph: () => {
      const spend = [0.4, 0.8, 0.3, 0, 0, 0.6, 0.9, 0.5, 0.7, 0.2, 0, 0, 0.5, 1, 0.6, 0.3, 0.8, 0, 0, 0.4, 0.7, 0.9, 0.5, 0.6]
      return spend
        .map((v, i) => {
          const today = i === spend.length - 1
          return `<rect x="${16 + (i % 8) * 21}" y="${16 + Math.floor(i / 8) * 15}" width="18" height="12" rx="2" fill="${v ? P.amber : P.line}" opacity="${v ? n(0.2 + v * 0.8) : 1}"${today ? ` stroke="${P.amber}" stroke-width="1.2"` : ''}>${today ? `<animate attributeName="opacity" values="0.4;1;0.4" dur="2.4s" repeatDur="20s"/>` : ''}</rect>`
        })
        .join('')
    },
  },
]

const cluster = () => {
  const tw = 200
  const th = 136
  const gap = 12
  let g = ''
  TILES.forEach((tile, i) => {
    const x = 22 + (i % 4) * (tw + gap)
    const y = 22 + Math.floor(i / 4) * (th + gap)
    g += `<g transform="translate(${x} ${y})">`
    g += `<rect width="${tw}" height="${th}" rx="12" fill="${P.panel}" stroke="${P.line}"/>`
    g += t(tw - 14, 92, String(i + 1).padStart(2, '0'), { font: MONO, size: 9, color: P.faint, anchor: 'end' })
    g += `<g>${tile.glyph()}</g>`
    g += t(16, 92, tile.title, { size: 13, weight: 600, color: P.ink })
    g += t(16, 110, tile.lines[0], { size: 10.5, color: P.sub })
    g += t(16, 124, tile.lines[1], { size: 10.5, color: P.sub })
    g += `</g>`
  })
  const rows = Math.ceil(TILES.length / 4)
  return plate(W, 22 * 2 + rows * th + (rows - 1) * gap, g, 'The sixteen instruments of Embermeter', 'cluster')
}

// ---------------------------------------------------------------- spec sheet

const spec = () => {
  const rows: [string, string][][] = [
    [
      ['Network', 'none'],
      ['Model calls', 'none'],
      ['Files written', 'none'],
      ['Processes spawned', 'none'],
      ['Runtime dependencies', '0'],
      ['Timers', '1'],
    ],
    [
      ['Sensor period', '5 s'],
      ['Context breakdown', '≤ 15 s'],
      ['Memory', 'capped'],
      ['Surfaces', 'VS Code · desktop · tty'],
      ['Themes', 'washi · night · day'],
      ['Licence', 'MIT'],
    ],
  ]
  let g = t(30, 40, 'SPECIFICATIONS', { font: MONO, size: 10, color: P.amber, ls: 3 })
  g += t(W - 30, 40, 'model EM-1, reference build', { font: SERIF, size: 12, italic: true, color: P.faint, anchor: 'end' })
  g += `<line x1="22" y1="52" x2="${W - 22}" y2="52" stroke="${P.line}"/>`
  rows.forEach((col, c) => {
    const x0 = c === 0 ? 30 : 466
    const x1 = c === 0 ? 414 : W - 30
    col.forEach(([k, v], i) => {
      const y = 84 + i * 30
      const kw = k.length * 7.6
      const vw = v.length * 7.9
      g += t(x0, y, k, { font: SERIF, size: 14, italic: true, color: P.sub })
      g += `<line x1="${n(x0 + kw + 10)}" y1="${y - 3}" x2="${n(x1 - vw - 10)}" y2="${y - 3}" stroke="${P.faint}" stroke-width="1.2" stroke-dasharray="1 5" stroke-linecap="round"/>`
      g += t(x1, y, v, { font: MONO, size: 12.5, color: v === 'none' || v === '0' ? P.sage : P.ink, anchor: 'end' })
    })
  })
  g += `<line x1="440" y1="66" x2="440" y2="236" stroke="${P.grid}"/>`
  g += t(W / 2, 262, 'Vitals read from Linux /sys and /proc. On other platforms they read “–” and the heat guard rests.', { font: SERIF, size: 12, italic: true, color: P.faint, anchor: 'middle' })
  return plate(W, 286, g, 'Specifications: no network, no model calls, no files written, no processes, zero dependencies, one timer', 'spec')
}

// ---------------------------------------------------------------- sign-off

const signoff = () => {
  const cx = W / 2
  let g = sun('end', cx, 62, 34)
  g += mountain('end', cx - 70, 98, 0.62)
  g += flock(
    [
      [cx + 14, 44, 0.55],
      [cx + 28, 37, 0.5],
    ],
    -6,
    -3,
    9,
  )
  g += t(cx, 132, 'Keep the ember low.', { font: SERIF, size: 20, italic: true, color: P.ink, anchor: 'middle' })
  g += t(cx, 154, 'EMBERMETER · MODEL EM-1 · MIT', { font: MONO, size: 9.5, color: P.faint, anchor: 'middle', ls: 3 })
  g += seal(W - 74, 120, 30, 'EM')
  return plate(W, 176, g, 'Keep the ember low.', 'end', sunDefs('end') + inkDefs('end'))
}

const files: Record<string, string> = { 'hero.svg': hero(), 'cluster.svg': cluster(), 'spec.svg': spec(), 'signoff.svg': signoff() }
SECTIONS.forEach(([id], i) => (files[`section-${id}.svg`] = section(i)))
for (const [name, svg] of Object.entries(files)) writeFileSync(join(out, name), svg)
console.log(`${Object.keys(files).length} art files rendered to ${out}`)
