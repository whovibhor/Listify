import { useState, type FormEvent } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AtSignIcon, Loader2Icon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useEditComment,
} from '@/features/collaboration/api'
import type { TaskComment } from '@/features/collaboration/types'
import { MemberAvatar } from '@/features/organizations/components/MemberAvatar'
import { useMembers } from '@/features/organizations/api'
import type { TaskDetail } from '@/features/tasks/types'
import { PeoplePicker } from '@/features/work/components/PeoplePicker'
import { errorText } from '@/lib/api-client'

const MAX_COMMENT_LENGTH = 5000

function CommentItem({ comment, readOnly }: { comment: TaskComment; readOnly: boolean }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body ?? '')
  const edit = useEditComment(comment.task_id)
  const remove = useDeleteComment(comment.task_id)
  const fail = (error: Error) => toast.error(errorText(error))

  const save = (event: FormEvent) => {
    event.preventDefault()
    edit.mutate(
      { id: comment.id, body: body.trim() },
      { onSuccess: () => setEditing(false), onError: fail },
    )
  }

  return (
    <li className="flex gap-2.5">
      <MemberAvatar name={comment.author.name} className="size-7 text-[0.65rem]" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{comment.author.name}</span>
          <time dateTime={comment.created_at} className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
          </time>
          {comment.edited && !comment.deleted ? (
            <span className="text-xs text-muted-foreground">edited</span>
          ) : null}
        </p>
        {comment.deleted ? (
          <p className="text-sm text-muted-foreground italic">This comment was deleted.</p>
        ) : editing ? (
          <form onSubmit={save} className="mt-1 space-y-2">
            <Textarea
              aria-label="Edit comment"
              value={body}
              maxLength={MAX_COMMENT_LENGTH}
              className="min-h-16"
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={edit.isPending || !body.trim()}>
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setBody(comment.body ?? '')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm wrap-anywhere whitespace-pre-wrap">{comment.body}</p>
        )}
        {!readOnly && !editing && (comment.can_edit || comment.can_delete) ? (
          <div className="mt-0.5 flex gap-1">
            {comment.can_edit ? (
              <Button
                variant="ghost"
                size="xs"
                aria-label="Edit your comment"
                onClick={() => setEditing(true)}
              >
                <PencilIcon data-icon="inline-start" />
                Edit
              </Button>
            ) : null}
            {comment.can_delete ? (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Delete comment by ${comment.author.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(comment.id, { onError: fail })}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function TaskComments({ task, readOnly }: { task: TaskDetail; readOnly: boolean }) {
  const { data, isPending, isError } = useComments(task.id)
  const add = useAddComment(task.id)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<number[]>([])
  const organizationId = task.organization_id
  const { data: members } = useMembers(
    organizationId ?? 0,
    { status: 'active', page_size: 100 },
    { enabled: organizationId !== null },
  )
  const people = organizationId ? (members?.items ?? []) : []
  const nameOf = (userId: number) =>
    people.find((person) => person.user_id === userId)?.name ?? 'Someone'
  const toggle = (userId: number) =>
    setMentions(
      mentions.includes(userId) ? mentions.filter((id) => id !== userId) : [...mentions, userId],
    )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    add.mutate(
      { body: trimmed, mention_user_ids: mentions },
      {
        onSuccess: () => {
          setBody('')
          setMentions([])
        },
        onError: (error) => toast.error(errorText(error)),
      },
    )
  }

  if (isPending) return <Skeleton className="h-16 w-full" />
  if (isError) return <p className="text-sm text-muted-foreground">Comments couldn't be loaded.</p>

  return (
    <div className="space-y-3">
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((comment) => (
            <CommentItem key={comment.id} comment={comment} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            aria-label="Add a comment"
            placeholder="Add a comment…"
            value={body}
            maxLength={MAX_COMMENT_LENGTH}
            className="min-h-16"
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="submit" size="sm" disabled={add.isPending || !body.trim()}>
              {add.isPending ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              Comment
            </Button>
            {organizationId ? (
              <PeoplePicker
                label="Mention"
                icon={AtSignIcon}
                people={people}
                selected={mentions}
                onToggle={toggle}
              />
            ) : null}
            {mentions.map((userId) => (
              <Badge key={userId} variant="secondary">
                @{nameOf(userId)}
                <button
                  type="button"
                  aria-label={`Don’t mention ${nameOf(userId)}`}
                  onClick={() => toggle(userId)}
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </form>
      )}
    </div>
  )
}
