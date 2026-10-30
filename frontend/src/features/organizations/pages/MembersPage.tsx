import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, UsersRoundIcon } from 'lucide-react'
import { motion } from 'motion/react'

import { NativeSelect } from '@/components/shared/NativeSelect'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDepartments, useMembers } from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import type { Member } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { pageEnter } from '@/lib/motion'

const PAGE_SIZE = 25

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

function MemberRow({ member }: { member: Member }) {
  const roles = member.roles.filter((role) => role.key !== 'member' || member.roles.length === 1)
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-card sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="size-10">
          <AvatarFallback className="bg-secondary text-sm font-semibold text-secondary-foreground">
            {initials(member.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium">{member.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {member.job_title ? `${member.job_title} · ` : ''}
            {member.email}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        {member.status === 'suspended' ? <Badge variant="destructive">Suspended</Badge> : null}
        {roles.map((role) => (
          <Badge key={`${role.key}-${role.department_id}`}>{role.name}</Badge>
        ))}
        {member.departments.map((department) => (
          <Badge key={department.id} variant="secondary">
            {department.name}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground sm:ml-2">
          Joined {format(new Date(member.joined_at), 'd MMM yyyy')}
        </span>
      </div>
    </li>
  )
}

export function MembersPage() {
  const org = useOrg()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [page, setPage] = useState(1)
  const { data: departments = [] } = useDepartments(org.id)
  const { data, isPending, isError, error, refetch } = useMembers(org.id, {
    q: q || undefined,
    department_id: departmentId ? Number(departmentId) : undefined,
    page,
    page_size: PAGE_SIZE,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(text.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [text])

  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const seesEveryone = can(org, 'member.manage') || can(org, 'member.approve')

  return (
    <motion.div {...pageEnter} className="space-y-5">
      <PageHeader
        title="Members"
        description={
          seesEveryone ? 'Everyone in this organization.' : 'People in your departments.'
        }
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search members by name or email"
            placeholder="Search by name or email"
            value={text}
            maxLength={100}
            onChange={(event) => setText(event.target.value)}
            className="pl-8"
          />
        </div>
        <NativeSelect
          aria-label="Filter by department"
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value)
            setPage(1)
          }}
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={UsersRoundIcon}
          title="No members found"
          description="Try a different search or department."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {data.items.map((member) => (
              <MemberRow key={member.membership_id} member={member} />
            ))}
          </ul>
          {pageCount > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {pageCount}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </motion.div>
  )
}
