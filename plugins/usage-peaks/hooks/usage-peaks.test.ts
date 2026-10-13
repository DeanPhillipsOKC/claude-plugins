import { expect, mock, test } from 'claude-code/testing'

import { chartRows, record, report, series } from './usage'

const RESET = '2026-10-13T19:50:00Z'
const NOW = Date.parse('2026-10-13T16:00:00Z')
const five = (percentUsed: number, resetsAt = RESET) => ({ kind: 'five_hour', percentUsed, resetsAt })

test('keeps the highest reading of a window', () => {
  let peaks = record({}, [five(20)], NOW)
  peaks = record(peaks, [five(64)], NOW + 60e3)
  peaks = record(peaks, [five(30, '2026-10-13T19:50:04Z')], NOW + 120e3)
  expect(peaks.five_hour?.length).toBe(1)
  expect(peaks.five_hour?.[0]?.peak).toBe(64)
})

test('starts a new window after the reset', () => {
  let peaks = record({}, [five(90)], NOW)
  peaks = record(peaks, [five(3, '2026-10-14T00:50:00Z')], NOW + 5 * 3600e3)
  expect(peaks.five_hour?.map(w => w.peak)).toEqual([90, 3])
})

test('report counts near misses', () => {
  let peaks = record({}, [five(85, '2026-10-12T19:50:00Z')], NOW - 864e5)
  peaks = record(peaks, [five(40)], NOW)
  const text = report(peaks, 14, NOW)
  expect(text).toContain('highest 85%')
  expect(text).toContain('80%: 1')
})

test('measure readings reach /usage-peaks', async ($, on) => {
  const status: (string | undefined)[] = []
  mock.clock(on, { now: Date.now() })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.status', (_$, e) => (status.push(e.text), { value: undefined }))
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  const measure = (pct: number) =>
    $.session.measure({
      context: { window: 200000, isAutoCompactEnabled: true, apiUsage: null } as never,
      rateLimits: [five(pct, new Date(Date.now() + 3600e3).toISOString())],
      changed: ['rateLimits'],
    })
  await measure(12)
  await measure(71)
  await measure(40)
  const out = await $.command.run({ command: 'usage-peaks', args: '' } as never)
  expect(out.text).toContain('highest 71%')
  expect(status.at(-1)).toBe('5h 40%')
})

test('graph series carries a reading until its window resets', () => {
  const H = 3600e3
  const now = Date.parse('2026-10-13T12:00:00Z')
  const samples = [
    { t: now - 10 * H, p: 30, r: now - 8 * H },
    { t: now - 9 * H, p: 60, r: now - 8 * H },
    { t: now - 2 * H, p: 15, r: now + 3 * H },
  ]
  // 12 hours shown as 12 one-hour columns.
  const values = series(samples, 0.5, now, 12)
  expect(values.slice(0, 2)).toEqual([null, null])
  expect(values[2]).toBe(30)
  expect(values[3]).toBe(60)
  expect(values[4]).toBe(0)
  expect(values[10]).toBe(15)
  expect(values[11]).toBe(15)
})

test('chart rows fill from the bottom', () => {
  const rows = chartRows([100, 50, 0, null], 2)
  expect(rows).toEqual(['█   ', '██ ·'])
})
