import type { SessionRateLimit } from 'claude-code'

import type { Sample } from '../types'

// One usage window, keyed by when it resets. `peak` is the highest
// percentage any session on this machine saw before the reset.
export type Window = { resetsAt: string; peak: number; peakAt: string }
export type Peaks = Record<string, Window[]>

const HOUR = 3600e3
const DAY = 24 * HOUR
const FIVE_HOURS = 5 * HOUR
const SPAN: Record<string, number> = { five_hour: FIVE_HOURS, seven_day: 7 * DAY }
const KEEP_WINDOWS = 400
export const KEEP_SAMPLE_DAYS = 30

export const asPeaks = (v: unknown): Peaks =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Peaks) : {}
export const asSamples = (v: unknown): Sample[] => (Array.isArray(v) ? (v as Sample[]) : [])

// resetsAt can wobble by a few seconds between responses; a window is the
// same window when its reset lands within ten minutes of a known one.
const sameWindow = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) < 10 * 60e3

export const record = (peaks: Peaks, limits: readonly SessionRateLimit[], now: number): Peaks => {
  const out: Peaks = { ...peaks }
  for (const l of limits) {
    const resetsAt = l.resetsAt
    if (!resetsAt || !(l.kind in SPAN)) continue
    const list = [...(out[l.kind] ?? [])]
    const i = list.findIndex(w => sameWindow(w.resetsAt, resetsAt))
    const seen = list[i]
    const at = new Date(now).toISOString()
    if (!seen) list.push({ resetsAt, peak: l.percentUsed, peakAt: at })
    else if (l.percentUsed > seen.peak) list[i] = { ...seen, peak: l.percentUsed, peakAt: at }
    else continue
    list.sort((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt))
    out[l.kind] = list.slice(-KEEP_WINDOWS)
  }
  return out
}

export const addSample = (samples: Sample[], limits: readonly SessionRateLimit[], now: number): Sample[] => {
  const five = limits.find(l => l.kind === 'five_hour')
  if (!five?.resetsAt) return samples
  const keep = samples.filter(s => s.t > now - KEEP_SAMPLE_DAYS * DAY)
  return [...keep, { t: now, p: five.percentUsed, r: Date.parse(five.resetsAt) }]
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const when = (ms: number) => {
  const d = new Date(ms)
  return `${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const bar = (pct: number) => '#'.repeat(Math.round(Math.min(pct, 100) / 5)).padEnd(20, '.')

export const report = (peaks: Peaks, days: number, now: number): string => {
  const since = now - days * DAY
  const five = (peaks.five_hour ?? []).filter(w => Date.parse(w.resetsAt) > since)
  if (five.length === 0) return `No 5-hour windows recorded in the last ${days} days yet.`

  const top = Math.max(...five.map(w => w.peak))
  const over = (n: number) => five.filter(w => w.peak >= n).length
  const lines = [
    `5-hour windows, last ${days} days: ${five.length} seen, highest ${top}%.`,
    `At or over 50%: ${over(50)}   80%: ${over(80)}   90%: ${over(90)}`,
    '',
    'Window start      Peak',
    ...five.map(w => {
      const start = when(Date.parse(w.resetsAt) - FIVE_HOURS)
      const live = Date.parse(w.resetsAt) > now ? '  (now)' : ''
      return `${start.padEnd(17)} ${String(w.peak).padStart(4)}%  ${bar(w.peak)}${live}`
    }),
  ]
  const weeks = (peaks.seven_day ?? []).filter(w => Date.parse(w.resetsAt) > since)
  if (weeks.length) {
    lines.push('', 'Weekly windows', ...weeks.map(w =>
      `resets ${when(Date.parse(w.resetsAt)).padEnd(17)} ${String(w.peak).padStart(4)}%  ${bar(w.peak)}`))
  }
  lines.push('', 'Peaks only cover windows where a Claude Code session on this machine got a response.')
  return lines.join('\n')
}

// The 5-hour percentage per column over [now - days, now]. A column with no
// reading carries the last one forward until that window resets, then reads
// 0; null means nothing was recorded yet at that point.
export const series = (samples: readonly Sample[], days: number, now: number, width: number): (number | null)[] => {
  const start = now - days * DAY
  const step = (now - start) / width
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const out: (number | null)[] = []
  let last: Sample | undefined
  let i = 0
  while (i < sorted.length && sorted[i]!.t < start) last = sorted[i++]
  for (let c = 0; c < width; c++) {
    const end = start + (c + 1) * step
    let top: number | null = last ? (last.r > start + c * step ? last.p : 0) : null
    while (i < sorted.length && sorted[i]!.t < end) {
      const s = sorted[i++]!
      top = Math.max(top ?? 0, s.p)
      last = s
    }
    out.push(top)
  }
  return out
}

const EIGHTHS = ' ▁▂▃▄▅▆▇█'

// Rows of a column chart, top row first, each `height` rows tall over 0-100%.
export const chartRows = (values: readonly (number | null)[], height: number): string[] => {
  const rows: string[] = []
  for (let row = height; row >= 1; row--) {
    let line = ''
    for (const v of values) {
      if (v === null) { line += row === 1 ? '·' : ' '; continue }
      const level = (Math.min(v, 100) / 100) * height
      const fill = Math.max(0, Math.min(1, level - (row - 1)))
      line += EIGHTHS[Math.round(fill * 8)]
    }
    rows.push(line)
  }
  return rows
}

// A label row with each local midnight's weekday under its column.
export const dayAxis = (days: number, now: number, width: number): string => {
  const start = now - days * DAY
  const step = (now - start) / width
  const cells = Array<string>(width).fill(' ')
  const d = new Date(start)
  d.setHours(24, 0, 0, 0)
  for (; d.getTime() < now; d.setDate(d.getDate() + 1)) {
    const col = Math.floor((d.getTime() - start) / step)
    // Narrow graphs get the bare date so more days fit.
    const label = width < 60 ? `|${d.getMonth() + 1}/${d.getDate()}` : `|${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`
    if (col + label.length > width || cells.slice(col, col + label.length + 1).some(c => c !== ' ')) {
      if (col < width && cells[col] === ' ') cells[col] = '|'
      continue
    }
    for (let k = 0; k < label.length; k++) cells[col + k] = label[k]!
  }
  return cells.join('')
}

// The whole graph as plain lines: header, chart, axis, day labels.
export const graphLines = (samples: readonly Sample[], days: number, now: number, width: number, height = 10): string[] => {
  const values = series(samples, days, now, width)
  const seen = values.filter((v): v is number => v !== null)
  const top = seen.length ? Math.max(...seen) : 0
  // Each row's label is the percentage at its top edge.
  const label = (i: number) =>
    (i === 0 || i === height / 2 ? `${Math.round(((height - i) / height) * 100)}%` : '').padStart(5) + ' │'
  return [
    `Highest in view: ${top}%   now: ${samples.at(-1)?.p ?? '?'}%`,
    ...chartRows(values, height).map((row, i) => label(i) + row),
    '   0% └' + '─'.repeat(width),
    '       ' + dayAxis(days, now, width),
  ]
}
