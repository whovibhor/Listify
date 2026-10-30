import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { PasswordInput } from '@/components/shared/PasswordInput'
import { Button } from '@/components/ui/button'
import { useResetPassword } from '@/features/auth/api'
import { AuthHeading, FormAlert } from '@/features/auth/components/AuthLayout'
import {
  MIN_PASSWORD_LENGTH,
  resetPasswordSchema,
  type ResetPasswordValues,
} from '@/features/auth/schemas'
import { ApiError } from '@/lib/api-client'
import { applyServerErrors } from '@/lib/form-errors'

export function ResetPasswordPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const reset = useResetPassword()
  // Read the token once, then drop it from the address bar so it doesn't linger in history
  // or leak through the Referer header.
  const [token] = useState(() => params.get('token'))
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const { errors } = form.formState

  useEffect(() => {
    if (params.has('token')) setParams({}, { replace: true })
  }, [params, setParams])

  if (!token) {
    return (
      <>
        <AuthHeading
          title="Reset link missing"
          description="Open the link from your email again, or request a new one."
        />
        <Button asChild size="lg" className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </>
    )
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setFormError(null)
    try {
      await reset.mutateAsync({ token, password })
      toast.success('Password updated', { description: 'Sign in with your new password.' })
      navigate('/login', { replace: true })
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError, ['password']))
    }
  })

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        description="You'll be signed out on all devices after the change."
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        {reset.error instanceof ApiError && reset.error.code === 'invalid_token' ? (
          <Link
            to="/forgot-password"
            className="block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Request a new reset link
          </Link>
        ) : null}
        <FormField
          label="New password"
          error={errors.password?.message}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={reset.isPending}>
          {reset.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Update password
        </Button>
      </form>
    </>
  )
}
