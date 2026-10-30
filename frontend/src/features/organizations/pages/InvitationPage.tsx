import { Building2Icon, Loader2Icon, MailXIcon } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAcceptInvitation, useInvitationPreview } from '@/features/organizations/api'
import { ApiError } from '@/lib/api-client'

export function InvitationPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { data, isPending, isError, error, refetch } = useInvitationPreview(token)
  const accept = useAcceptInvitation()

  const onAccept = () =>
    accept.mutate(token, {
      onSuccess: ({ organization_id }) => {
        toast.success(`Welcome to ${data?.organization_name}`)
        navigate(`/org/${organization_id}`, { replace: true })
      },
      onError: (mutationError) => toast.error(mutationError.message),
    })

  return (
    <div className="mx-auto max-w-lg py-6">
      {isPending ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : isError ? (
        error instanceof ApiError && (error.status === 400 || error.status === 403) ? (
          <EmptyState
            icon={MailXIcon}
            title="This invitation can't be used"
            description={error.message}
          />
        ) : (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        )
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-4 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <Building2Icon aria-hidden className="size-7" />
            </span>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">You’re invited to join</p>
              <h1 className="text-2xl font-semibold tracking-tight">{data.organization_name}</h1>
              {data.organization_description ? (
                <p className="text-sm text-muted-foreground">{data.organization_description}</p>
              ) : null}
            </div>
            <p className="text-sm">
              as <span className="font-medium">{data.role_name}</span>
              {data.department_name ? (
                <>
                  {' '}
                  in <span className="font-medium">{data.department_name}</span>
                </>
              ) : null}
            </p>
            {data.already_member ? (
              <Button onClick={() => navigate(`/org/${data.organization_id}`)}>
                You’re already a member. Open it
              </Button>
            ) : (
              <Button size="lg" onClick={onAccept} disabled={accept.isPending}>
                {accept.isPending ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : null}
                Accept invitation
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Your personal tasks stay private. The organization can’t see them.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
