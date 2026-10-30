import { useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { CheckIcon, Loader2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { PermissionDenied } from '@/features/organizations/components/OrganizationLayout'
import {
  useApproveRequest,
  useDepartments,
  useMembershipRequests,
  useRejectRequest,
} from '@/features/organizations/api'
import { can, canAnywhere } from '@/features/organizations/permissions'
import {
  ROLE_OPTIONS,
  type AssignableRole,
  type MembershipRequest,
} from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { errorText } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

function ApproveDialog({ request, onClose }: { request: MembershipRequest; onClose: () => void }) {
  const org = useOrg()
  const approve = useApproveRequest(org.id)
  const { data: departments = [] } = useDepartments(org.id)
  const [departmentId, setDepartmentId] = useState(
    request.requested_department_id ? String(request.requested_department_id) : '',
  )
  const [role, setRole] = useState<AssignableRole>('member')
  const [error, setError] = useState<string>()
  const canAssignRoles = can(org, 'role.assign')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    approve.mutate(
      {
        id: request.id,
        department_id: departmentId ? Number(departmentId) : null,
        role_key: role,
      },
      {
        onSuccess: () => {
          toast.success(`${request.user_name} joined ${org.name}`)
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
          <DialogTitle>Approve {request.user_name}</DialogTitle>
          <DialogDescription>
            You can change the department or role before approving.
          </DialogDescription>
        </DialogHeader>
        <form id="approve-form" onSubmit={submit} className="space-y-4">
          <FormField label="Department" error={error}>
            <NativeSelect
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value)
                setError(undefined)
              }}
            >
              <option value="">No department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {canAssignRoles ? (
            <FormField
              label="Role"
              hint={ROLE_OPTIONS.find((option) => option.value === role)?.description}
            >
              <NativeSelect
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as AssignableRole)
                  setError(undefined)
                }}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="submit" form="approve-form" disabled={approve.isPending}>
            {approve.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({ request, onClose }: { request: MembershipRequest; onClose: () => void }) {
  const org = useOrg()
  const reject = useRejectRequest(org.id)
  const [note, setNote] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    reject.mutate(
      { id: request.id, note: note.trim() },
      {
        onSuccess: () => {
          toast.success('Request declined')
          onClose()
        },
        onError: (error) => toast.error(errorText(error)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline {request.user_name}’s request?</DialogTitle>
          <DialogDescription>They get no access and can see this was declined.</DialogDescription>
        </DialogHeader>
        <form id="reject-form" onSubmit={submit}>
          <FormField label="Reason (optional, shown to them)">
            <Textarea
              value={note}
              maxLength={500}
              className="min-h-20"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="reject-form"
            variant="destructive"
            disabled={reject.isPending}
          >
            Decline request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Decision = { kind: 'approve' | 'reject'; request: MembershipRequest }

function RequestCard({
  request,
  onDecide,
}: {
  request: MembershipRequest
  onDecide: (decision: Decision) => void
}) {
  const pending = request.status === 'pending'
  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Avatar className="size-10">
          <AvatarFallback className="bg-secondary text-sm font-semibold text-secondary-foreground">
            {request.user_name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium">{request.user_name}</p>
          <p className="truncate text-sm text-muted-foreground">{request.user_email}</p>
          <p className="mt-1 text-sm">
            {request.requested_department_name ?? 'No department chosen'}
            {request.job_title ? ` · ${request.job_title}` : ''}
          </p>
          {request.note ? (
            <p className="mt-1 text-sm text-muted-foreground italic">“{request.note}”</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {format(new Date(request.created_at), 'd MMM yyyy, HH:mm')}
          </p>
        </div>
      </div>
      {pending ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() => onDecide({ kind: 'reject', request })}
            aria-label={`Decline ${request.user_name}`}
          >
            <XIcon data-icon="inline-start" />
            Decline
          </Button>
          <Button
            onClick={() => onDecide({ kind: 'approve', request })}
            aria-label={`Approve ${request.user_name}`}
          >
            <CheckIcon data-icon="inline-start" />
            Approve
          </Button>
        </div>
      ) : (
        <Badge variant="secondary" className="capitalize">
          {request.status}
        </Badge>
      )}
    </li>
  )
}

export function RequestsPage() {
  const org = useOrg()
  const allowed = canAnywhere(org, 'member.approve')
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [decision, setDecision] = useState<Decision | null>(null)
  const { data, isPending, isError, error, refetch } = useMembershipRequests(
    org.id,
    tab === 'pending' ? 'pending' : undefined,
    { enabled: allowed },
  )

  if (!allowed) return <PermissionDenied />

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Join requests"
        description="People asking to join. They get no access until you approve."
        actions={
          <div
            role="tablist"
            aria-label="Request filter"
            className="inline-flex rounded-lg bg-muted p-1"
          >
            {(['pending', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  tab === value
                    ? 'bg-card text-foreground shadow-card'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        }
      />
      {isPending ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={UserPlusIcon}
          title={tab === 'pending' ? 'No pending requests' : 'No requests yet'}
          description="When someone asks to join, you’ll review it here."
        />
      ) : (
        <ul className="space-y-3">
          {data.items.map((request) => (
            <RequestCard key={request.id} request={request} onDecide={setDecision} />
          ))}
        </ul>
      )}
      {decision?.kind === 'approve' ? (
        <ApproveDialog request={decision.request} onClose={() => setDecision(null)} />
      ) : null}
      {decision?.kind === 'reject' ? (
        <RejectDialog request={decision.request} onClose={() => setDecision(null)} />
      ) : null}
    </motion.div>
  )
}
