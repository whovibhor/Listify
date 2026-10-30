import { useState, type FormEvent } from 'react'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Building2Icon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useDepartments,
  useSaveDepartment,
  useSetDepartmentArchived,
} from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import type { Department } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

function DepartmentDialog({
  organizationId,
  department,
  onClose,
}: {
  organizationId: number
  department: Department | null
  onClose: () => void
}) {
  const save = useSaveDepartment(organizationId)
  const [name, setName] = useState(department?.name ?? '')
  const [description, setDescription] = useState(department?.description ?? '')
  const [open, setOpen] = useState(department?.open_for_join_requests ?? true)
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Enter a name.')
    save.mutate(
      {
        id: department?.id,
        name: name.trim(),
        description: description.trim() || null,
        open_for_join_requests: open,
      },
      {
        onSuccess: () => {
          toast.success(department ? 'Department saved' : 'Department created')
          onClose()
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? 'Edit department' : 'New department'}</DialogTitle>
          <DialogDescription>A team inside this organization.</DialogDescription>
        </DialogHeader>
        <form id="department-form" onSubmit={submit} className="space-y-4">
          <FormField label="Name" error={error}>
            <Input
              autoFocus
              value={name}
              maxLength={100}
              onChange={(event) => {
                setName(event.target.value)
                setError(undefined)
              }}
            />
          </FormField>
          <FormField label="Description (optional)">
            <Textarea
              value={description}
              maxLength={500}
              className="min-h-20"
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="open-for-requests" className="text-sm font-medium">
                Open for join requests
              </label>
              <p className="text-xs text-muted-foreground">
                People asking to join can choose this department.
              </p>
            </div>
            <Switch id="open-for-requests" checked={open} onCheckedChange={setOpen} />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="department-form" disabled={save.isPending}>
            {save.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            {department ? 'Save changes' : 'Create department'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DepartmentCard({
  department,
  canEdit,
  onEdit,
}: {
  department: Department
  canEdit: boolean
  onEdit: () => void
}) {
  const org = useOrg()
  const setArchived = useSetDepartmentArchived(org.id)
  const archived = department.status === 'archived'

  const toggleArchive = () =>
    setArchived.mutate(
      { id: department.id, archived: !archived },
      {
        onSuccess: () => toast.success(archived ? 'Department restored' : 'Department archived'),
        onError: (error) => toast.error(error.message),
      },
    )

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card',
        archived && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Building2Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{department.name}</h2>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <UsersRoundIcon aria-hidden className="size-3.5" />
            {department.member_count} member{department.member_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {department.description ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{department.description}</p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {archived ? (
          <Badge variant="secondary">Archived</Badge>
        ) : department.open_for_join_requests ? (
          <Badge variant="secondary">Open for requests</Badge>
        ) : (
          <Badge variant="outline">Closed to requests</Badge>
        )}
        {canEdit ? (
          <div className="ml-auto flex items-center gap-1">
            {archived ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${department.name}`}
                onClick={onEdit}
              >
                <PencilIcon />
              </Button>
            )}
            {archived ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Restore ${department.name}`}
                disabled={setArchived.isPending}
                onClick={toggleArchive}
              >
                <ArchiveRestoreIcon />
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Archive ${department.name}`}>
                    <ArchiveIcon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive {department.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It closes to new members and join requests. Existing members and history are
                      kept, and you can restore it any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={toggleArchive}>
                      Archive department
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function DepartmentsPage() {
  const org = useOrg()
  const canCreate = can(org, 'department.create')
  const [showArchived, setShowArchived] = useState(false)
  const [dialog, setDialog] = useState<{ department: Department | null } | null>(null)
  const { data, isPending, isError, error, refetch } = useDepartments(org.id, {
    archived: showArchived,
  })

  return (
    <motion.div {...pageEnter} className="space-y-5">
      <PageHeader
        title="Departments"
        description={
          canCreate
            ? 'Teams in this organization and who can ask to join them.'
            : 'The departments you belong to.'
        }
        actions={
          canCreate ? (
            <Button onClick={() => setDialog({ department: null })}>
              <PlusIcon data-icon="inline-start" />
              New department
            </Button>
          ) : null
        }
      />
      {canCreate ? (
        <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title={canCreate ? 'No departments yet' : 'You’re not in a department yet'}
          description={
            canCreate
              ? 'Create your first department so people can join a team.'
              : 'An administrator will add you to one.'
          }
          action={
            canCreate ? (
              <Button onClick={() => setDialog({ department: null })}>Create a department</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((department) => (
            <DepartmentCard
              key={department.id}
              department={department}
              canEdit={can(org, 'department.update', department.id)}
              onEdit={() => setDialog({ department })}
            />
          ))}
        </ul>
      )}

      {dialog ? (
        <DepartmentDialog
          organizationId={org.id}
          department={dialog.department}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </motion.div>
  )
}
