import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '@/components/ui/button'
import type { TrendPoint } from '@/features/reports/types'

const SERIES = [
  { key: 'completed', label: 'Completed', color: 'var(--chart-1)' },
  { key: 'created', label: 'Created', color: 'var(--chart-2)' },
] as const

function LineKey({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-0.5 w-3.5 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  )
}

interface TooltipPayload {
  active?: boolean
  payload?: { payload: TrendPoint }[]
}

function TrendTooltip({ active, payload }: TooltipPayload) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-overlay">
      <p className="mb-1 font-medium">{format(parseISO(point.date), 'EEE d MMM yyyy')}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center gap-1.5">
          <LineKey color={series.color} />
          {series.label}: <span className="font-semibold tabular-nums">{point[series.key]}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * Two series on one scale: 2px lines with a crosshair, a legend that names them with their totals
 * (identity never relies on color), and a table for screen readers and exact values. The colors
 * passed the dataviz validator in both themes.
 */
export function ReportTrendChart({ trend }: { trend: TrendPoint[] }) {
  const [showTable, setShowTable] = useState(false)
  const totals = {
    completed: trend.reduce((sum, point) => sum + point.completed, 0),
    created: trend.reduce((sum, point) => sum + point.created, 0),
  }
  const dense = trend.length > 14
  const empty = totals.completed === 0 && totals.created === 0

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {SERIES.map((series) => (
            <span key={series.key} className="inline-flex items-center gap-1.5">
              <LineKey color={series.color} />
              {series.label}{' '}
              <span className="font-medium text-foreground tabular-nums">{totals[series.key]}</span>
            </span>
          ))}
        </figcaption>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTable((value) => !value)}
          aria-expanded={showTable}
          disabled={empty}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      {empty ? (
        <p className="rounded-lg bg-muted/60 px-3 py-8 text-center text-sm text-muted-foreground">
          No tasks were created or completed in this period.
        </p>
      ) : showTable ? (
        <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/30">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Day
                </th>
                {SERIES.map((series) => (
                  <th key={series.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {series.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...trend].reverse().map((point) => (
                <tr key={point.date} className="border-t">
                  <td className="px-3 py-1.5">{format(parseISO(point.date), 'EEE d MMM yyyy')}</td>
                  {SERIES.map((series) => (
                    <td key={series.key} className="px-3 py-1.5 text-right tabular-nums">
                      {point[series.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="h-56"
          role="img"
          aria-label={`Line chart of tasks per day: ${totals.completed} completed and ${totals.created} created.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                tickFormatter={(value: string) =>
                  format(parseISO(value), dense ? 'd MMM' : 'EEE d')
                }
                interval={dense ? 'preserveStartEnd' : 0}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                domain={[0, (dataMax: number) => Math.max(4, dataMax)]}
              />
              <Tooltip
                content={<TrendTooltip />}
                cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
              />
              {SERIES.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={trend.length < 3 ? { r: 4, fill: series.color, strokeWidth: 0 } : false}
                  activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
