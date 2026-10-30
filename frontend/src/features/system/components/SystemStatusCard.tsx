import { ActivityIcon, DatabaseIcon, ServerIcon, type LucideIcon } from 'lucide-react'

import { ErrorState } from '@/components/shared/StatePanels'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useHealth, type DependencyState } from '@/features/system/api'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

function StatusRow({
  icon: Icon,
  label,
  state,
  detail,
}: {
  icon: LucideIcon
  label: string
  state: DependencyState
  detail?: string
}) {
  const ok = state === 'ok'
  return (
    <li className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {detail ? <span className="text-xs text-muted-foreground tabular-nums">{detail}</span> : null}
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium',
          ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
        )}
      >
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-destructive')}
        />
        {ok ? 'Operational' : 'Unavailable'}
      </span>
    </li>
  )
}

/** Live service health from GET /api/v1/health — no mocked values. */
export function SystemStatusCard() {
  const { data, error, isPending, refetch, isRefetching } = useHealth()

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon aria-hidden className="size-4 text-primary" />
          System status
        </CardTitle>
        <CardDescription>Live check of the API and its database connection.</CardDescription>
      </CardHeader>
      <CardContent aria-live="polite" aria-busy={isPending || isRefetching}>
        {isPending ? (
          <div className="space-y-2" data-testid="status-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorState
            title="API unreachable"
            message={
              error instanceof ApiError && error.isNetworkError
                ? 'The backend is not responding. Start it with `uvicorn app.main:app --reload` in backend/.'
                : error.message
            }
            onRetry={() => void refetch()}
          />
        ) : (
          <ul className="space-y-2">
            <StatusRow
              icon={ServerIcon}
              label="API"
              state="ok"
              detail={`v${data.version} · ${data.environment}`}
            />
            {Object.entries(data.checks).map(([name, check]) => (
              <StatusRow
                key={name}
                icon={DatabaseIcon}
                label={name === 'database' ? 'Database (MySQL)' : name}
                state={check.status}
                detail={check.latency_ms != null ? `${check.latency_ms} ms` : undefined}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
