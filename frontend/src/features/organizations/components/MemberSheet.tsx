import { useState, type FormEvent, type ReactNode } from 'react'
import { format } from 'date-fns'
import {
  ArrowRightLeftIcon,
  CrownIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  ShieldIcon,
  UserMinusIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/shared/NativeSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  ChangeRolesDialog,
  ImpactDialog,
  TransferOwnershipDialog,
} from '@/features/organizations/components/MemberChangeDialogs'
import { MemberAvatar } from '@/features/organizations/components/MemberAvatar'
import {
  useAddMemberDepartment,
  useDepartments,
  useReactivateMember,
} from '@/features/organizations/api'
import { roleLabel } from '@/features/organizations/permissions'
import type { ImpactAction, Member } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { errorText } from '@/lib/api-client'

type DepartmentRef = { id: number; name: string }

type OpenDialog =
  | { kind: 'roles' }
  | { kind: 'owner' }
  | { kind: 'impact'; action: ImpactAction; department?: DepartmentRef }

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function AddToDepartment({ member }: { member: Member }) {
  const org = useOrg()
  const { data: departments = [] } = useDepartments(org.id)
  const add = useAddMemberDepartment(org.id, member.membership_id)
  const [departmentId, setDepartmentId] = useState('')
  const available = departments.filter(
    (department) => !member.departments.some((current) => current.id === department.id),
  )
  if (available.length === 0) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    add.mutate(Number(departmentId), {
      onSuccess: () => setDepartmentId(''),
      onError: (error) => toast.error(errorText(error)),
    })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <NativeSelect
        aria-label="Add to a department"
        required
        value={departmentId}
        onChange={(event) => setDepartmentId(event.target.value)}
      >
        <option value="">Add to a department</option>
        {available.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" disabled={!departmentId || add.isPending}>
        Add
      </Button>
    </form>
  )
}

/** One member's roles, departments and the changes the current user may make to them. */
export function MemberSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const org = useOrg()
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const reactivate = useReactivateMember(org.id, member.membership_id)
  const { data: departments = [] } = useDepartments(org.id)
  const allowed = (action: Member['actions'][number]) => member.actions.includes(action)
  const closeDialog = () => setDialog(null)
  const canMove =
    allowed('transfer') &&
    departments.some(
      (department) => !member.departments.some((current) => current.id === department.id),
    )
  const visibleRoles = member.roles.filter(
    (role) => role.key !== 'member' || member.roles.length === 1,
  )

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <div className="space-y-4 p-6">
          <header className="flex items-center gap-3 pr-8">
            <MemberAvatar name={member.name} className="size-12" />
            <div className="min-w-0">
              <SheetTitle className="truncate">{member.name}</SheetTitle>
              <SheetDescription className="truncate">{member.email}</SheetDescription>
            </div>
          </header>

          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {member.status === 'suspended' ? <Badge variant="destructive">Suspended</Badge> : null}
            {member.job_title ? <span>{member.job_title}</span> : null}
            <span>Joined {format(new Date(member.joined_at), 'd MMM yyyy')}</span>
          </p>

          <Section
            title="Roles"
            action={
              allowed('change_roles') ? (
                <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'roles' })}>
                  <ShieldIcon data-icon="inline-start" />
                  Change roles
                </Button>
              ) : null
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {visibleRoles.map((role) => (
                <Badge key={`${role.key}-${role.department_id}`}>
                  {roleLabel(role, member.departments)}
                </Badge>
              ))}
            </div>
          </Section>

          <Section title="Departments">
            {member.departments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not in a department yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {member.departments.map((department) => (
                  <li
                    key={department.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{department.name}</span>
                    <span className="flex shrink-0 items-center">
                      {canMove ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${member.name} out of ${department.name}`}
                          onClick={() =>
                            setDialog({ kind: 'impact', action: 'transfer', department })
                          }
                        >
                          <ArrowRightLeftIcon data-icon="inline-start" />
                          Move
                        </Button>
                      ) : null}
                      {allowed('leave_department') ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Take ${member.name} out of ${department.name}`}
                          onClick={() =>
                            setDialog({ kind: 'impact', action: 'leave_department', department })
                          }
                        >
                          <XIcon />
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {allowed('add_department') ? <AddToDepartment member={member} /> : null}
          </Section>

          {allowed('suspend') ||
          allowed('reactivate') ||
          allowed('remove') ||
          allowed('make_owner') ? (
            <Section title="Membership">
              <div className="grid grid-cols-1 gap-2">
                {allowed('reactivate') ? (
                  <Button
                    variant="outline"
                    className="justify-start"
                    disabled={reactivate.isPending}
                    onClick={() =>
                      reactivate.mutate(undefined, {
                        onSuccess: () => toast.success(`${member.name} is active again`),
                        onError: (error) => toast.error(errorText(error)),
                      })
                    }
                  >
                    <PlayCircleIcon data-icon="inline-start" />
                    Reactivate
                  </Button>
                ) : null}
                {allowed('make_owner') ? (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setDialog({ kind: 'owner' })}
                  >
                    <CrownIcon data-icon="inline-start" />
                    Make Owner
                  </Button>
                ) : null}
                {allowed('suspend') ? (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setDialog({ kind: 'impact', action: 'suspend' })}
                  >
                    <PauseCircleIcon data-icon="inline-start" />
                    Suspend
                  </Button>
                ) : null}
                {allowed('remove') ? (
                  <Button
                    variant="outline"
                    className="justify-start text-destructive hover:text-destructive"
                    onClick={() => setDialog({ kind: 'impact', action: 'remove' })}
                  >
                    <UserMinusIcon data-icon="inline-start" />
                    Remove from organization
                  </Button>
                ) : null}
              </div>
            </Section>
          ) : null}
        </div>

        {dialog?.kind === 'roles' ? (
          <ChangeRolesDialog member={member} onClose={closeDialog} />
        ) : null}
        {dialog?.kind === 'owner' ? (
          <TransferOwnershipDialog member={member} onClose={closeDialog} />
        ) : null}
        {dialog?.kind === 'impact' ? (
          <ImpactDialog
            member={member}
            action={dialog.action}
            department={dialog.department}
            onClose={closeDialog}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
