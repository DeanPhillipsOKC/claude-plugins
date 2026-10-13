import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import { addSample, asPeaks, asSamples, chartRows, dayAxis, record, report, series } from './usage'

const PEAKS = 'peaks'
const SAMPLES = 'samples'
const PANE = 'usage-graph'
const samples = atom({ plugin: 'usage-peaks', key: 'samples' } as const, [])
// Days the graph pane shows; the command sets it, the pane reads it.
let graphDays = 2

const statusText = (limits: readonly SessionRateLimit[]) => {
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  if (!five && !week) return undefined
  return [five && `5h ${five.percentUsed}%`, week && `wk ${week.percentUsed}%`].filter(Boolean).join(' · ')
}

const daysArg = (args: string, fallback: number) => {
  const n = Number.parseInt(args.trim(), 10)
  return n > 0 ? Math.min(n, 30) : fallback
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-peaks',
      description: 'Peak usage of each 5-hour window (default last 14 days; pass a number of days)',
    })
    await $.command.register({
      name: 'usage-graph',
      description: 'Graph the 5-hour usage % over time in a pane (default last 2 days; pass a number of days)',
    })
    const stored = asSamples(await $.store.get(SAMPLES))
    await update($, samples, () => stored)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length) {
      $.ui.status(statusText(e.rateLimits))
      if (e.changed.includes('rateLimits')) {
        const now = await $.clock.now()
        await $.store.set(PEAKS, record(asPeaks(await $.store.get(PEAKS)), e.rateLimits, now))
        // Re-read the store so readings from other sessions on this machine stay in.
        const list = addSample(asSamples(await $.store.get(SAMPLES)), e.rateLimits, now)
        await $.store.set(SAMPLES, list)
        await update($, samples, () => list)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'usage-peaks' }, async ($, e) => {
    const now = await $.clock.now()
    return { text: report(asPeaks(await $.store.get(PEAKS)), daysArg(e.args, 14), now) }
  })

  on('command.run', { command: 'usage-graph' }, async ($, e) => {
    graphDays = daysArg(e.args, 2)
    const stored = asSamples(await $.store.get(SAMPLES))
    await update($, samples, () => stored)
    await $.ui.open({ id: PANE, title: `5-hour usage, last ${graphDays} days` })
    return { text: `Usage graph opened (last ${graphDays} days).` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, samples)
    const now = await $.clock.now()
    const width = Math.max(20, Math.min(240, (e.viewport?.columns ?? 80) - 8))
    const height = 10
    const values = series(list, graphDays, now, width)
    const rows = chartRows(values, height)
    const seen = values.filter((v): v is number => v !== null)
    const top = seen.length ? Math.max(...seen) : 0
    const label = (i: number) => {
      const pct = Math.round(((height - i) / height) * 100)
      return (i === 0 || i === height / 2 || i === height - 1 ? `${pct}%` : '').padStart(5) + ' │'
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No readings yet. They arrive with each response.</Text>}
        <Text>Highest in view: {top}%   now: {list.at(-1)?.p ?? '?'}%</Text>
        {rows.map((row, i) => (
          <Text color={i < height * 0.2 ? 'red' : undefined}>{label(i)}{row}</Text>
        ))}
        <Text dimColor>{'      └' + '─'.repeat(width)}</Text>
        <Text dimColor>{'       ' + dayAxis(graphDays, now, width)}</Text>
        <Text dimColor>Top two rows are 80% and up. · marks time before the first reading.</Text>
      </Box>
    )
  })
}
