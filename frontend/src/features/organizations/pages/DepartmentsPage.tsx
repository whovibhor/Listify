import { useState } from 'react'
import { Building2Icon, PlusIcon, UsersRoundIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, Navigate } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useDepartments } from '@/features/organizations/api'
import {
  DepartmentControls,
  DepartmentDialog,
} from '@/features/organizations/components/DepartmentControls'
import { DepartmentTabs } from '@/features/organizations/components/DepartmentTabs'
import { can, isOrganizationAdmin } from '@/features/organizations/permissions'
import type { Department } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

function DepartmentCard({ department, canEdit }: { department: Department; canEdit: boolean }) {
  const archived = department.status === 'archived'

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
          <h2 className="truncate font-semibold">
            <Link
              to={department.id.toString()}
              className="underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {department.name}
            </Link>
          </h2>
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
          <div className="ml-auto">
            <DepartmentControls department={department} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function DepartmentsPage() {
  const org = useOrg()
  const canCreate = isOrganizationAdmin(org)
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const { data, isPending, isError, error, refetch } = useDepartments(org.id, {
    archived: showArchived,
  })

  // Everyone else goes straight to their own department, which has everything about it.
  if (!canCreate && data?.length) {
    return <Navigate to={`/org/${org.id}/departments/${data[0].id}`} replace />
  }

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader
        title={canCreate ? 'Departments' : 'Department'}
        description={canCreate ? 'Teams in this organization and who can ask to join them.' : null}
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New department
            </Button>
          ) : null
        }
      />
      {canCreate ? <DepartmentTabs organizationId={org.id} /> : null}
      {canCreate ? (
        <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              <Button onClick={() => setCreating(true)}>Create a department</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((department) => (
            <DepartmentCard
              key={department.id}
              department={department}
              canEdit={can(org, 'department.update', department.id)}
            />
          ))}
        </ul>
      )}

      {creating ? (
        <DepartmentDialog
          organizationId={org.id}
          department={null}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </motion.div>
  )
}
