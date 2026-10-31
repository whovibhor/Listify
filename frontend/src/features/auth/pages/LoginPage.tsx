import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { FormField } from '@/components/shared/FormField'
import { PasswordInput } from '@/components/shared/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLogin } from '@/features/auth/api'
import { AuthHeading, FormAlert } from '@/features/auth/components/AuthLayout'
import { loginSchema, type LoginValues } from '@/features/auth/schemas'
import { applyServerErrors, safeRedirectPath } from '@/lib/form-errors'

export function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const login = useLogin()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login.mutateAsync(values)
      navigate(safeRedirectPath(params.get('next')), {
        replace: true,
        state: { resumeWorkspace: true },
      })
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError, ['email', 'password']))
      form.resetField('password', { keepError: true })
    }
  })

  return (
    <>
      <AuthHeading title="Sign in" description="Welcome back. Pick up where you left off." />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <FormField label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </FormField>
        <FormField
          label="Password"
          error={errors.password?.message}
          labelAside={
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          {login.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Denote?{' '}
        <Link
          to={{ pathname: '/register', search: params.toString() }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  )
}
