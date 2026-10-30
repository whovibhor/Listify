import { Link } from 'react-router'

export interface BreakdownItem {
  key: string
  label: string
  value: number
  to?: string
}

/**
 * Horizontal magnitude bars in plain HTML: the category label and value are text, so identity
 * never depends on color; one hue for every bar (magnitude, not identity).
 */
export function BreakdownBars({ items, label }: { items: BreakdownItem[]; label: string }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <ul aria-label={label} className="space-y-2.5">
      {items.map((item) => {
        const row = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span>{item.label}</span>
              <span className="font-medium tabular-nums">{item.value}</span>
            </span>
            <span aria-hidden className="mt-1 block h-2 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-chart-1 transition-[width] duration-(--duration-slow) ease-(--ease-standard)"
                style={{
                  width: `${(item.value / max) * 100}%`,
                  minWidth: item.value ? '0.5rem' : 0,
                }}
              />
            </span>
          </>
        )
        return (
          <li key={item.key}>
            {item.to && item.value > 0 ? (
              <Link
                to={item.to}
                className="block rounded-md outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        )
      })}
    </ul>
  )
}
