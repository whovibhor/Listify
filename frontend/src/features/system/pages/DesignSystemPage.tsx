import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskPriorityBadge, TaskStatusBadge } from '@/features/tasks/components/TaskBadges'
import { TASK_PRIORITIES, TASK_STATUSES } from '@/features/tasks/task-meta'

const swatches = [
  'primary',
  'secondary',
  'accent',
  'muted',
  'success',
  'warning',
  'info',
  'destructive',
] as const

/** Development-only reference for tokens and shared components (route is not registered in production). */
export function DesignSystemPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Design system"
        description="Tokens and shared components. Use these instead of page-specific styles."
        actions={
          <Button onClick={() => toast.success('Task created', { description: 'Toast preview' })}>
            <PlusIcon data-icon="inline-start" />
            New task
          </Button>
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Color tokens</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {swatches.map((name) => (
            <div key={name} className="overflow-hidden rounded-lg border bg-card shadow-card">
              <div className="h-12" style={{ background: `var(--${name})` }} />
              <p className="px-2 py-1.5 font-mono text-xs">{name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Task status</CardTitle>
            <CardDescription>Icon + label + color; never color alone.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {TASK_STATUSES.map((status) => (
              <TaskStatusBadge key={status} status={status} />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Priority</CardTitle>
            <CardDescription>Default priority is Medium.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {TASK_PRIORITIES.map((priority) => (
              <TaskPriorityBadge key={priority} priority={priority} />
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
          <Button disabled>Disabled</Button>
          <Badge>Badge</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ds-title">Task title</Label>
          <Input id="ds-title" placeholder="e.g. Draft Q4 report" />
          <Label htmlFor="ds-invalid">Invalid field</Label>
          <Input id="ds-invalid" aria-invalid aria-describedby="ds-invalid-msg" defaultValue="" />
          <p id="ds-invalid-msg" className="text-sm text-destructive">
            Title is required.
          </p>
        </div>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </section>
    </div>
  )
}
