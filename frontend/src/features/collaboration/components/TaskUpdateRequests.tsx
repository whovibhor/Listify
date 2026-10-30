import { useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { MessageCircleQuestionIcon } from 'lucide-react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useCancelUpdate,
  useRequestUpdate,
  useRespondToUpdate,
  useUpdateRequests,
} from '@/features/collaboration/api'
import type { UpdateRequest } from '@/features/collaboration/types'
import { STATUS_LABELS, type TaskStatus } from '@/features/tasks/task-meta'
import type { TaskDetail } from '@/features/tasks/types'
import { errorText } from '@/lib/api-client'

const STATUS_TEXT: Record<UpdateRequest['status'], string> = {
  pending: 'Waiting',
  responded: 'Answered',
  cancelled: 'Cancelled',
}

function AskDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const request = useRequestUpdate(task.id)
  const people = [...(task.assignee ? [task.assignee] : []), ...task.collaborators]
  const [recipient, setRecipient] = useState(String(people[0]?.id ?? ''))
  const [message, setMessage] = useState('')
  const [respondBy, setRespondBy] = useState('')
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    request.mutate(
      {
        recipient_id: Number(recipient),
        message: message.trim(),
        respond_by: respondBy || null,
      },
      {
        onSuccess: () => {
          toast.success('Update requested')
          onClose()
        },
        onError: (mutationError) => setError(errorText(mutationError)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request an update</DialogTitle>
          <DialogDescription>They’ll see this in their Inbox.</DialogDescription>
        </DialogHeader>
        <form id="ask-update-form" onSubmit={submit} className="space-y-4">
          <FormField label="Who to ask">
            <NativeSelect value={recipient} onChange={(event) => setRecipient(event.target.value)}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="What would you like to know?" error={error}>
            <Textarea
              required
              value={message}
              maxLength={1000}
              className="min-h-20"
              onChange={(event) => setMessage(event.target.value)}
            />
          </FormField>
          <FormField label="Answer by (optional)">
            <Input
              type="date"
              value={respondBy}
              onChange={(event) => setRespondBy(event.target.value)}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="ask-update-form"
            disabled={request.isPending || !message.trim() || !recipient}
          >
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Answering, from the task panel or the Inbox. A status change is optional. */
export function RespondDialog({
  request,
  statuses,
  onClose,
}: {
  request: UpdateRequest
  statuses: TaskStatus[]
  onClose: () => void
}) {
  const respond = useRespondToUpdate()
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    respond.mutate(
      {
        id: request.id,
        response_note: note.trim(),
        status: (status || null) as TaskStatus | null,
      },
      {
        onSuccess: () => {
          toast.success('Response sent')
          onClose()
        },
        onError: (mutationError) => setError(errorText(mutationError)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Respond to {request.requester.name}</DialogTitle>
          <DialogDescription className="wrap-anywhere whitespace-pre-wrap">
            {request.message}
          </DialogDescription>
        </DialogHeader>
        <form id="respond-update-form" onSubmit={submit} className="space-y-4">
          <FormField label="Your update" error={error}>
            <Textarea
              required
              value={note}
              maxLength={1000}
              className="min-h-20"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          {statuses.length > 0 ? (
            <FormField label="Change status (optional)">
              <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Keep the current status</option>
                {statuses.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="respond-update-form"
            disabled={respond.isPending || !note.trim()}
          >
            Send response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskUpdateRequests({ task, readOnly }: { task: TaskDetail; readOnly: boolean }) {
  const { data, isPending, isError } = useUpdateRequests(task.id)
  const cancel = useCancelUpdate()
  const [asking, setAsking] = useState(false)
  const [responding, setResponding] = useState<UpdateRequest | null>(null)
  const canAsk =
    !readOnly &&
    task.actions.includes('request_update') &&
    (task.assignee !== null || task.collaborators.length > 0)

  if (isPending) return <Skeleton className="h-16 w-full" />
  if (isError) return <p className="text-sm text-muted-foreground">Requests couldn't be loaded.</p>

  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No update requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((request) => (
            <li key={request.id} className="space-y-1 rounded-lg bg-muted/60 p-2.5 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{request.requester.name}</span> asked{' '}
                  <span className="font-medium">{request.recipient.name}</span>
                </span>
                <Badge variant={request.status === 'pending' ? 'default' : 'secondary'}>
                  {STATUS_TEXT[request.status]}
                </Badge>
              </p>
              <p className="wrap-anywhere whitespace-pre-wrap">{request.message}</p>
              {request.respond_by ? (
                <p className="text-xs text-muted-foreground">
                  Answer by {format(new Date(request.respond_by), 'd MMM yyyy')}
                </p>
              ) : null}
              {request.response_note ? (
                <p className="rounded-md bg-card p-2 wrap-anywhere whitespace-pre-wrap">
                  {request.response_note}
                </p>
              ) : null}
              {request.can_respond || request.can_cancel ? (
                <div className="flex gap-1.5">
                  {request.can_respond ? (
                    <Button size="sm" onClick={() => setResponding(request)}>
                      Respond
                    </Button>
                  ) : null}
                  {request.can_cancel ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancel.isPending}
                      onClick={() =>
                        cancel.mutate(request.id, {
                          onError: (error) => toast.error(errorText(error)),
                        })
                      }
                    >
                      Cancel request
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canAsk ? (
        <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
          <MessageCircleQuestionIcon data-icon="inline-start" />
          Request an update
        </Button>
      ) : null}
      {asking ? <AskDialog task={task} onClose={() => setAsking(false)} /> : null}
      {responding ? (
        <RespondDialog
          request={responding}
          statuses={task.allowed_statuses}
          onClose={() => setResponding(null)}
        />
      ) : null}
    </div>
  )
}
