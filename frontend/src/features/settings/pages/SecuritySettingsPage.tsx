import { zodResolver } from '@hookform/resolvers/zod'
import { formatDistanceToNow } from 'date-fns'
import { Loader2Icon, MonitorSmartphoneIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { PasswordInput } from '@/components/shared/PasswordInput'
import { ErrorState } from '@/components/shared/StatePanels'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useChangePassword,
  useRevokeSession,
  useSessions,
  type UserSession,
} from '@/features/auth/api'
import {
  MIN_PASSWORD_LENGTH,
  changePasswordSchema,
  type ChangePasswordValues,
} from '@/features/auth/schemas'
import { applyServerErrors } from '@/lib/form-errors'
import { transitions } from '@/lib/motion'

function ChangePasswordForm() {
  const change = useChangePassword()
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async ({ current_password, new_password }) => {
    try {
      await change.mutateAsync({ current_password, new_password })
      form.reset()
      toast.success('Password changed', { description: 'Your other devices were signed out.' })
    } catch (error) {
      const message = applyServerErrors(error, form.setError, ['current_password', 'new_password'])
      if (message) toast.error(message)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormField label="Current password" error={errors.current_password?.message}>
        <PasswordInput autoComplete="current-password" {...form.register('current_password')} />
      </FormField>
      <FormField
        label="New password"
        error={errors.new_password?.message}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      >
        <PasswordInput autoComplete="new-password" {...form.register('new_password')} />
      </FormField>
      <FormField label="Confirm new password" error={errors.confirm?.message}>
        <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Change password
        </Button>
      </div>
    </form>
  )
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown OS'
  return `${browser} on ${os}`
}

function SessionRow({ session }: { session: UserSession }) {
  const revoke = useRevokeSession()
  const device = describeDevice(session.user_agent)

  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={transitions.base}
      className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
    >
      <MonitorSmartphoneIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {device}
          {session.current ? <Badge variant="secondary">This device</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {session.ip_address ?? 'Unknown IP'} · active{' '}
          {formatDistanceToNow(new Date(session.last_seen_at), { addSuffix: true })}
        </p>
      </div>
      {session.current ? null : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={revoke.isPending}>
              Sign out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out {device}?</AlertDialogTitle>
              <AlertDialogDescription>
                That device will need to sign in again to use Denote.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  revoke.mutate(session.id, {
                    onSuccess: () => toast.success('Device signed out'),
                    onError: (error) => toast.error(error.message),
                  })
                }
              >
                Sign out device
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </motion.li>
  )
}

function SessionsList() {
  const { data, isPending, error, refetch } = useSessions()
  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (error) return <ErrorState message={error.message} onRetry={() => void refetch()} />
  return (
    <ul className="space-y-2">
      <AnimatePresence initial={false}>
        {data.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </AnimatePresence>
    </ul>
  )
}

export function SecuritySettingsPage() {
  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing it signs you out everywhere except this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Where you're signed in</CardTitle>
          <CardDescription>Sign out any device you don't recognize.</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsList />
        </CardContent>
      </Card>
    </div>
  )
}
