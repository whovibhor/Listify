import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useReducedMotion } from 'motion/react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Button } from '@/components/ui/button'
import type { PersonalDashboard } from '@/features/dashboards/api'

interface TooltipPayload {
  active?: boolean
  payload?: { payload: PersonalDashboard['trend'][number] }[]
}

function TrendTooltip({ active, payload }: TooltipPayload) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-overlay">
      <p className="mb-1 font-medium">{format(parseISO(point.date), 'EEE d MMM')}</p>
      <p>
        <span className="mr-1.5 inline-block size-2 rounded-xs bg-chart-1 align-middle" />
        Completed: <span className="font-semibold tabular-nums">{point.completed}</span>
      </p>
      <p className="text-muted-foreground">Created: {point.created}</p>
    </div>
  )
}

/**
 * Tasks completed per local day: one series, so no legend; hover tooltip on every column and
 * a table view for screen readers and exact values (dataviz: marks ≤24px, 4px rounded tops,
 * hairline solid grid, text in text tokens).
 */
export function CompletionTrendChart({ trend }: { trend: PersonalDashboard['trend'] }) {
  const [showTable, setShowTable] = useState(false)
  const reduceMotion = useReducedMotion()
  const dense = trend.length > 31
  const max = Math.max(0, ...trend.map((point) => point.completed))
  const total = trend.reduce((sum, point) => sum + point.completed, 0)

  return (
    <figure className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm text-muted-foreground">
          {total} completed · busiest day {max}
        </figcaption>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTable((value) => !value)}
          aria-expanded={showTable}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      {showTable ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Completed
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {[...trend].reverse().map((point) => (
                <tr key={point.date} className="border-t">
                  <td className="px-3 py-1.5">{format(parseISO(point.date), 'EEE d MMM')}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{point.completed}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                    {point.created}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="h-56"
          role="img"
          aria-label={`Bar chart of tasks completed per day: ${total} in total.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={trend}
              margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
              barCategoryGap={dense ? 1 : '30%'}
            >
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
                minTickGap={12}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                domain={[0, (dataMax: number) => Math.max(4, dataMax)]}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.6 }} />
              <Bar
                dataKey="completed"
                name="Completed"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={!reduceMotion}
                animationDuration={320}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
