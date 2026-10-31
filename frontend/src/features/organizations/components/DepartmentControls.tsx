import { useState, type FormEvent } from 'react'
import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSaveDepartment, useSetDepartmentArchived } from '@/features/organizations/api'
import type { Department } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'

export function DepartmentDialog({
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

/** Edit, archive and restore, for people allowed to change this department. */
export function DepartmentControls({ department }: { department: Department }) {
  const org = useOrg()
  const setArchived = useSetDepartmentArchived(org.id)
  const [editing, setEditing] = useState(false)
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
    <div className="flex items-center gap-1">
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
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${department.name}`}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
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
                  It closes to new members and join requests. Existing members and history are kept,
                  and you can restore it any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={toggleArchive}>Archive department</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {editing ? (
        <DepartmentDialog
          organizationId={org.id}
          department={department}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}
