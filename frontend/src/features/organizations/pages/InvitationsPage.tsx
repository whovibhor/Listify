import { useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { CopyIcon, Loader2Icon, MailPlusIcon, Trash2Icon } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PermissionDenied } from '@/features/organizations/components/OrganizationLayout'
import {
  useCreateInvitation,
  useDepartments,
  useInvitations,
  useRevokeInvitation,
} from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import { ROLE_OPTIONS, type AssignableRole } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { ApiError } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'

function InviteForm() {
  const org = useOrg()
  const create = useCreateInvitation(org.id)
  const { data: departments = [] } = useDepartments(org.id)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('member')
  const [departmentId, setDepartmentId] = useState('')
  const [error, setError] = useState<string>()
  // The link holds a secret token and is shown once; the server keeps only its hash.
  const [link, setLink] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    create.mutate(
      {
        email: email.trim() || null,
        role_key: role,
        department_id: departmentId ? Number(departmentId) : null,
        expires_in_days: 7,
      },
      {
        onSuccess: (invitation) => {
          setLink(invitation.link)
          setEmail('')
          toast.success(
            invitation.email ? `Invitation sent to ${invitation.email}` : 'Link created',
          )
        },
        onError: (mutationError) =>
          setError(
            mutationError instanceof ApiError && mutationError.details[0]
              ? mutationError.details[0].message
              : mutationError.message,
          ),
      },
    )
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copied')
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it manually.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>
          Enter an email to send an invite, or leave it empty for a one-time link you can share.
          Admin invitations need an email. Invitations expire after 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <FormField label={role === 'admin' ? 'Email' : 'Email (optional)'} error={error}>
            <Input
              type="email"
              autoComplete="off"
              required={role === 'admin'}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Role">
              <NativeSelect
                value={role}
                onChange={(event) => setRole(event.target.value as AssignableRole)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Department">
              <NativeSelect
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">No department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <MailPlusIcon data-icon="inline-start" />
            )}
            {email.trim() ? 'Send invitation' : 'Create link'}
          </Button>
        </form>
        {link ? (
          <div className="mt-4 space-y-1.5 rounded-lg bg-accent/50 p-3">
            <p className="text-sm font-medium">Invitation link (shown once)</p>
            <div className="flex gap-2">
              <Input
                readOnly
                aria-label="Invitation link"
                value={link}
                onFocus={(e) => e.target.select()}
              />
              <Button type="button" variant="secondary" onClick={() => void copy()}>
                <CopyIcon data-icon="inline-start" />
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function InvitationsPage() {
  const org = useOrg()
  const allowed = can(org, 'member.manage')
  const { data, isPending, isError, error, refetch } = useInvitations(org.id)
  const revoke = useRevokeInvitation(org.id)

  if (!allowed) return <PermissionDenied />

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Invitations"
        description="Bring people in directly, without a join request."
      />
      <InviteForm />
      {isPending ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={MailPlusIcon}
          title="No invitations yet"
          description="Invitations you create appear here with their status."
        />
      ) : (
        <ul className="space-y-2">
          {data.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card p-3 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{invitation.email ?? 'Shareable link'}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {invitation.role_name}
                  {invitation.department_name ? ` · ${invitation.department_name}` : ''} · expires{' '}
                  {format(new Date(invitation.expires_at), 'd MMM yyyy')}
                </p>
              </div>
              <Badge variant="secondary" className="capitalize">
                {invitation.status}
              </Badge>
              {invitation.status === 'pending' ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke invitation for ${invitation.email ?? 'shareable link'}`}
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(invitation.id, {
                      onSuccess: () => toast.success('Invitation revoked'),
                      onError: (mutationError) => toast.error(mutationError.message),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}
