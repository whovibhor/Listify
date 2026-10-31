import type { ReactNode } from 'react'
import { InfoIcon, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface StatTileProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  definition?: string
  hint?: ReactNode
  to?: string
  tone?: 'default' | 'danger'
}

/** Label · value · optional definition tooltip; links to the list behind the number. */
export function StatTile({
  label,
  value,
  icon: Icon,
  definition,
  hint,
  to,
  tone = 'default',
}: StatTileProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'flex items-center gap-1.5 text-sm text-muted-foreground',
            definition && 'pr-6',
          )}
        >
          <Icon
            aria-hidden
            className={cn('size-4 shrink-0', tone === 'danger' && 'text-destructive')}
          />
          {label}
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  )
  const base =
    'relative block h-full rounded-xl bg-card p-3 shadow-card transition-shadow duration-(--duration-fast)'

  return (
    <div className="relative h-full">
      {to ? (
        <Link
          to={to}
          className={cn(
            base,
            'outline-none hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={base}>{body}</div>
      )}
      {definition ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`How “${label}” is calculated`}
              className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <InfoIcon className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{definition}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
