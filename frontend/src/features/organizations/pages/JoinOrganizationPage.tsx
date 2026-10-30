import { useEffect, useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { Building2Icon, ChevronRightIcon, Loader2Icon, MapPinIcon, SearchIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  useCancelJoinRequest,
  useDiscoverOrganizations,
  useJoinInfo,
  useMyJoinRequests,
  useRequestToJoin,
} from '@/features/organizations/api'
import type {
  MyJoinRequest,
  OrganizationPublic,
  RequestStatus,
} from '@/features/organizations/types'
import { ApiError } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Cancelled',
}

function JoinDialog({ organizationId, onClose }: { organizationId: number; onClose: () => void }) {
  const { data: info, isPending, isError, error } = useJoinInfo(organizationId)
  const join = useRequestToJoin()
  const [departmentId, setDepartmentId] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const needsDepartment = (info?.departments.length ?? 0) > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (needsDepartment && !departmentId) {
      setFormError('Choose a department.')
      return
    }
    join.mutate(
      {
        organizationId,
        department_id: departmentId ? Number(departmentId) : null,
        job_title: jobTitle.trim() || undefined,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Request sent', { description: 'You’ll get access once it’s approved.' })
          onClose()
        },
        onError: (mutationError) =>
          setFormError(
            mutationError instanceof ApiError && mutationError.details[0]
              ? mutationError.details[0].message
              : mutationError.message,
          ),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info ? `Join ${info.name}` : 'Join organization'}</DialogTitle>
          <DialogDescription>
            An administrator reviews your request. You get no access until it’s approved.
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <ErrorState message={error.message} />
        ) : (
          <form id="join-form" onSubmit={submit} className="space-y-4">
            {needsDepartment ? (
              <FormField label="Department" error={formError ?? undefined}>
                <NativeSelect
                  value={departmentId}
                  onChange={(event) => {
                    setDepartmentId(event.target.value)
                    setFormError(null)
                  }}
                >
                  <option value="">Choose a department…</option>
                  {info.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <FormField label="Job title (optional)">
              <Input
                value={jobTitle}
                maxLength={120}
                onChange={(event) => setJobTitle(event.target.value)}
              />
            </FormField>
            <FormField label="Note to the administrator (optional)">
              <Textarea
                value={note}
                maxLength={500}
                className="min-h-20"
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
          </form>
        )}
        <DialogFooter>
          <Button type="submit" form="join-form" disabled={join.isPending || isPending || isError}>
            {join.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResultRow({
  organization,
  onChoose,
}: {
  organization: OrganizationPublic
  onChoose: () => void
}) {
  const status = organization.my_status
  return (
    <li className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
        <Building2Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{organization.name}</p>
        {organization.description ? (
          <p className="truncate text-sm text-muted-foreground">{organization.description}</p>
        ) : null}
        {organization.location ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPinIcon aria-hidden className="size-3" />
            {organization.location}
          </p>
        ) : null}
      </div>
      {status === 'member' ? (
        <Button asChild variant="secondary" size="sm">
          <Link to={`/org/${organization.id}`}>Open</Link>
        </Button>
      ) : status === 'pending' ? (
        <Badge variant="secondary">Pending</Badge>
      ) : (
        <Button size="sm" onClick={onChoose} aria-label={`Request to join ${organization.name}`}>
          Request to join
        </Button>
      )}
    </li>
  )
}

function MyRequestRow({ request }: { request: MyJoinRequest }) {
  const cancel = useCancelJoinRequest()
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{request.organization_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {request.requested_department_name ? `${request.requested_department_name} · ` : ''}
          {format(new Date(request.created_at), 'd MMM yyyy')}
          {request.review_note ? ` · “${request.review_note}”` : ''}
        </p>
      </div>
      <Badge variant={request.status === 'approved' ? 'default' : 'secondary'}>
        {STATUS_LABELS[request.status]}
      </Badge>
      {request.status === 'approved' ? (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/org/${request.organization_id}`}>
            Open
            <ChevronRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      ) : null}
      {request.status === 'pending' ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate(request.id, {
              onSuccess: () => toast.success('Request cancelled'),
              onError: (error) => toast.error(error.message),
            })
          }
        >
          Cancel
        </Button>
      ) : null}
    </li>
  )
}

export function JoinOrganizationPage() {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [chosenId, setChosenId] = useState<number | null>(null)
  const results = useDiscoverOrganizations(query)
  const { data: requests = [] } = useMyJoinRequests()

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [text])

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Join an organization"
        description="Search for your organization and ask to join. Got an invitation link? Just open it."
      />

      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          type="search"
          aria-label="Search organizations by name"
          placeholder="Search by organization name"
          value={text}
          maxLength={100}
          onChange={(event) => setText(event.target.value)}
          className="h-11 rounded-xl bg-card pl-9 shadow-card"
        />
      </div>

      {query.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Only organizations that chose to be searchable appear here. Others join by invitation.
        </p>
      ) : results.isPending ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : results.isError ? (
        <ErrorState message={results.error.message} onRetry={() => void results.refetch()} />
      ) : results.data.items.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title={`No organizations match “${query}”`}
          description="Check the spelling, or ask your administrator for an invitation link."
        />
      ) : (
        <ul className="space-y-2">
          {results.data.items.map((organization) => (
            <ResultRow
              key={organization.id}
              organization={organization}
              onChoose={() => setChosenId(organization.id)}
            />
          ))}
        </ul>
      )}

      {requests.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Your requests</CardTitle>
            <CardDescription>Requests give no access until they’re approved.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {requests.map((request) => (
                <MyRequestRow key={request.id} request={request} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {chosenId !== null ? (
        <JoinDialog organizationId={chosenId} onClose={() => setChosenId(null)} />
      ) : null}
    </motion.div>
  )
}
