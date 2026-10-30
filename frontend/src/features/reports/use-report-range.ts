import { format, parseISO, subDays } from 'date-fns'
import { useSearchParams } from 'react-router'

import type { ReportRange } from '@/features/reports/api'
import { todayKey } from '@/features/tasks/dates'

export const REPORT_PRESETS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '1y', label: '1 year', days: 365 },
] as const

export type ReportPreset = (typeof REPORT_PRESETS)[number]['value'] | 'custom'

const DEFAULT_PRESET = '30d'

/**
 * The reporting period, kept in the URL so that links between reports carry it.
 * Presets send only a start: the server knows what today is in the organization's timezone.
 */
export function useReportRange(timezone: string) {
  const [params, setParams] = useSearchParams()
  const start = params.get('start')
  const end = params.get('end')
  const preset: ReportPreset =
    start && end
      ? 'custom'
      : (REPORT_PRESETS.find((option) => option.value === params.get('range'))?.value ??
        DEFAULT_PRESET)

  const days = REPORT_PRESETS.find((option) => option.value === preset)?.days
  const range: ReportRange =
    start && end
      ? { start, end }
      : {
          start: format(subDays(parseISO(todayKey(timezone)), (days ?? 30) - 1), 'yyyy-MM-dd'),
        }

  const search = (() => {
    const kept = new URLSearchParams()
    for (const key of ['range', 'start', 'end']) {
      const value = params.get(key)
      if (value) kept.set(key, value)
    }
    const text = kept.toString()
    return text ? `?${text}` : ''
  })()

  return {
    preset,
    range,
    search,
    choosePreset: (value: Exclude<ReportPreset, 'custom'>) =>
      setParams(value === DEFAULT_PRESET ? {} : { range: value }, { replace: true }),
    chooseDates: (from: string, to: string) =>
      setParams({ start: from, end: to }, { replace: true }),
  }
}
