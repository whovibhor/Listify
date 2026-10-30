import { useState, type FormEvent } from 'react'
import { format, parseISO } from 'date-fns'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ReportPeriod } from '@/features/reports/types'
import { REPORT_PRESETS, type useReportRange } from '@/features/reports/use-report-range'
import { todayKey } from '@/features/tasks/dates'
import { cn } from '@/lib/utils'

const CHIP =
  'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

function chipState(active: boolean) {
  return active
    ? 'bg-card text-foreground shadow-card'
    : 'text-muted-foreground hover:text-foreground'
}

function CustomDates({
  timezone,
  period,
  onApply,
}: {
  timezone: string
  period: ReportPeriod | undefined
  onApply: (start: string, end: string) => void
}) {
  const [start, setStart] = useState(period?.start ?? '')
  const [end, setEnd] = useState(period?.end ?? '')
  const today = todayKey(timezone)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (start && end) onApply(start, end)
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="report-start">From</Label>
        <Input
          id="report-start"
          type="date"
          min="2000-01-01"
          max={today}
          value={start}
          onChange={(event) => setStart(event.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="report-end">To</Label>
        <Input
          id="report-end"
          type="date"
          min="2000-01-01"
          max={today}
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          className="w-40"
        />
      </div>
      <Button type="submit" variant="outline" disabled={!start || !end}>
        Apply
      </Button>
    </form>
  )
}

export function ReportRangePicker({
  control,
  timezone,
  period,
}: {
  control: ReturnType<typeof useReportRange>
  timezone: string
  period: ReportPeriod | undefined
}) {
  const [showDates, setShowDates] = useState(control.preset === 'custom')
  const customActive = showDates || control.preset === 'custom'

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Reporting period"
        className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-1"
      >
        {REPORT_PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={!customActive && control.preset === option.value}
            onClick={() => {
              setShowDates(false)
              control.choosePreset(option.value)
            }}
            className={cn(CHIP, chipState(!customActive && control.preset === option.value))}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={customActive}
          onClick={() => setShowDates(true)}
          className={cn(CHIP, chipState(customActive))}
        >
          Custom
        </button>
      </div>
      {customActive ? (
        <CustomDates timezone={timezone} period={period} onApply={control.chooseDates} />
      ) : null}
    </div>
  )
}

/** Every report says what it covers: the dates, the timezone and whose tasks. */
export function ReportScopeLine({ period, scope }: { period: ReportPeriod; scope?: string }) {
  const start = format(parseISO(period.start), 'd MMM yyyy')
  const end = format(parseISO(period.end), 'd MMM yyyy')
  return (
    <p className="text-xs text-muted-foreground">
      {start === end ? start : `${start} – ${end}`} · times in {period.timezone}
      {scope ? ` · ${scope}` : ''}
    </p>
  )
}
