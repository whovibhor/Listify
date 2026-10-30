import { formatDistanceToNow } from 'date-fns'

import { Skeleton } from '@/components/ui/skeleton'
import { describeActivity } from '@/features/tasks/activity-text'
import { useTaskActivity } from '@/features/tasks/api'

export function ActivityTimeline({ taskId }: { taskId: number }) {
  const { data, isPending, isError } = useTaskActivity(taskId)
  if (isPending) return <Skeleton className="h-16 w-full" />
  if (isError) return <p className="text-sm text-muted-foreground">Activity couldn't be loaded.</p>
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {data.map((activity) => (
        <li key={activity.id} className="relative text-sm">
          <span
            aria-hidden
            className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary/60"
          />
          <span className="font-medium">{activity.actor_name ?? 'Someone'}</span>{' '}
          <span className="text-muted-foreground">{describeActivity(activity)}</span>
          <time dateTime={activity.created_at} className="block text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
          </time>
        </li>
      ))}
    </ol>
  )
}
