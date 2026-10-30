import { useState, type FormEvent } from 'react'
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
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
  useChangeMemberRoles,
  useConfirmMemberChange,
  useDepartments,
  useMemberImpact,
  useTransferOwnership,
} from '@/features/organizations/api'
import { roleLabel } from '@/features/organizations/permissions'
import type { ImpactAction, Member, MemberImpact } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { errorText } from '@/lib/api-client'

interface DialogProps {
  member: Member
  onClose: () => void
}

type DepartmentRef = { id: number; name: string }

function names(departments: DepartmentRef[]) {
  return departments.map((department) => department.name).join(', ')
}

const COPY: Record<
  ImpactAction,
  {
    title: (name: string, department?: string) => string
    description: string
    confirm: string
    done: (name: string) => string
  }
> = {
  suspend: {
    title: (name) => `Suspend ${name}?`,
    description:
      'Their access stops on their next click. Roles and departments are kept, so you can reactivate them later.',
    confirm: 'Suspend member',
    done: (name) => `${name} is suspended`,
  },
  remove: {
    title: (name) => `Remove ${name}?`,
    description:
      'They lose all access to this organization. The activity log keeps its history, and they’d have to join again to come back.',
    confirm: 'Remove member',
    done: (name) => `${name} was removed`,
  },
  transfer: {
    title: (name) => `Move ${name}`,
    description: 'Their access to the old department ends as soon as you confirm.',
    confirm: 'Move member',
    done: (name) => `${name} was moved`,
  },
  leave_department: {
    title: (name, department) => `Take ${name} out of ${department}?`,
    description: 'Their access to this department ends as soon as you confirm.',
    confirm: 'Take out of department',
    done: (name) => `${name}’s departments were updated`,
  },
}

function ImpactSummary({ impact, member }: { impact: MemberImpact; member: Member }) {
  const paused = impact.action === 'suspend'
  const rows: [string, string][] = [
    [paused ? 'Access paused' : 'Loses access to', names(impact.departments_losing)],
    ['Joins', names(impact.departments_gaining)],
    ['Keeps', names(impact.departments_keeping)],
    [
      paused ? 'Roles paused' : 'Roles ending',
      impact.roles_ending.map((role) => roleLabel(role, member.departments)).join(', '),
    ],
  ]
  return (
    <div className="space-y-2 text-sm">
      <dl className="space-y-2 rounded-xl bg-muted/60 p-3">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Personal tasks</dt>
          <dd className="font-medium">Not affected</dd>
        </div>
      </dl>
      {impact.keeps_every_department ? (
        <p className="text-muted-foreground">
          Their organization-wide role still lets them see every department.
        </p>
      ) : null}
      {impact.sole_manager_of.length > 0 ? (
        <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-destructive">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {names(impact.sole_manager_of)} will have no Department Manager.
            {impact.pending_requests > 0
              ? ` ${impact.pending_requests} join ${impact.pending_requests === 1 ? 'request is' : 'requests are'} waiting there for an administrator.`
              : ''}
          </span>
        </p>
      ) : null}
    </div>
  )
}

/** Suspend, remove, transfer and leave-department: preview first, then confirm (PRD §6.7). */
export function ImpactDialog({
  member,
  action,
  department,
  onClose,
}: DialogProps & { action: ImpactAction; department?: DepartmentRef }) {
  const org = useOrg()
  const { data: departments = [] } = useDepartments(org.id)
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const copy = COPY[action]
  const isTransfer = action === 'transfer'
  const asksForReason = action === 'suspend' || action === 'remove'
  const ready = !isTransfer || Boolean(destination)
  const impact = useMemberImpact(
    org.id,
    member.membership_id,
    {
      action,
      from_department_id: department?.id,
      to_department_id: destination ? Number(destination) : undefined,
    },
    { enabled: ready },
  )
  const confirm = useConfirmMemberChange(org.id, member.membership_id, action)

  const destinations = departments.filter(
    (candidate) => !member.departments.some((current) => current.id === candidate.id),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    confirm.mutate(
      {
        reason: reason.trim() || null,
        from_department_id: department?.id,
        to_department_id: Number(destination),
      },
      {
        onSuccess: () => {
          toast.success(copy.done(member.name))
          onClose()
        },
        onError: (mutationError) => setError(errorText(mutationError)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Start on the dialog, not the reason box: a phone keyboard would cover the impact.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">{copy.title(member.name, department?.name)}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form id="impact-form" onSubmit={submit} className="space-y-4">
          {isTransfer ? (
            <FormField label={`Move from ${department?.name} to`}>
              <NativeSelect
                value={destination}
                required
                onChange={(event) => {
                  setDestination(event.target.value)
                  setError(undefined)
                }}
              >
                <option value="">Choose a department</option>
                {destinations.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          {!ready ? null : impact.isPending ? (
            <Skeleton aria-label="Checking the impact" className="h-24 w-full rounded-xl" />
          ) : impact.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText(impact.error)}
            </p>
          ) : (
            <ImpactSummary impact={impact.data} member={member} />
          )}
          {asksForReason ? (
            <FormField label="Reason (optional, kept in the activity log)">
              <Textarea
                value={reason}
                maxLength={500}
                className="min-h-16"
                onChange={(event) => setReason(event.target.value)}
              />
            </FormField>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="impact-form"
            variant={action === 'transfer' ? 'default' : 'destructive'}
            disabled={confirm.isPending || !impact.isSuccess}
          >
            {confirm.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const NO_ROLE = ''

export function ChangeRolesDialog({ member, onClose }: DialogProps) {
  const org = useOrg()
  const change = useChangeMemberRoles(org.id, member.membership_id)
  const [organizationRole, setOrganizationRole] = useState<'member' | 'admin'>(
    member.roles.some((role) => role.key === 'admin') ? 'admin' : 'member',
  )
  const [departmentRoles, setDepartmentRoles] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      member.roles.flatMap((role) =>
        role.department_id === null ? [] : [[role.department_id, role.key]],
      ),
    ),
  )
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    change.mutate(
      {
        organization_role: organizationRole,
        department_roles: Object.entries(departmentRoles)
          .filter(([, roleKey]) => roleKey !== NO_ROLE)
          .map(([departmentId, roleKey]) => ({
            department_id: Number(departmentId),
            role_key: roleKey as 'team_lead' | 'department_manager',
          })),
      },
      {
        onSuccess: () => {
          toast.success(`${member.name}’s roles were updated`)
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
          <DialogTitle className="pr-6">Change {member.name}’s roles</DialogTitle>
          <DialogDescription>Changes apply as soon as you save.</DialogDescription>
        </DialogHeader>
        <form id="roles-form" onSubmit={submit} className="space-y-4">
          <FormField
            label="Organization role"
            hint={
              organizationRole === 'admin'
                ? 'Admins manage members, departments and settings across the organization.'
                : 'Members work on tasks in their own departments.'
            }
          >
            <NativeSelect
              value={organizationRole}
              onChange={(event) => setOrganizationRole(event.target.value as 'member' | 'admin')}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </NativeSelect>
          </FormField>
          {member.departments.map((department) => (
            <FormField key={department.id} label={`Role in ${department.name}`}>
              <NativeSelect
                value={departmentRoles[department.id] ?? NO_ROLE}
                onChange={(event) =>
                  setDepartmentRoles({ ...departmentRoles, [department.id]: event.target.value })
                }
              >
                <option value={NO_ROLE}>No extra role</option>
                <option value="team_lead">Team Lead</option>
                <option value="department_manager">Department Manager</option>
              </NativeSelect>
            </FormField>
          ))}
          {member.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add them to a department to give them a department role.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="submit" form="roles-form" disabled={change.isPending}>
            {change.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TransferOwnershipDialog({ member, onClose }: DialogProps) {
  const org = useOrg()
  const transfer = useTransferOwnership(org.id)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    transfer.mutate(
      { membership_id: member.membership_id, password },
      {
        onSuccess: () => {
          toast.success(`${member.name} now owns ${org.name}`)
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
          <DialogTitle className="pr-6">Make {member.name} the Owner?</DialogTitle>
          <DialogDescription>
            There’s only one Owner. You’ll become an Admin, and only {member.name} could give
            ownership back.
          </DialogDescription>
        </DialogHeader>
        <form id="ownership-form" onSubmit={submit}>
          <FormField label="Your password" error={error}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError(undefined)
              }}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="ownership-form"
            variant="destructive"
            disabled={transfer.isPending}
          >
            {transfer.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            Transfer ownership
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
