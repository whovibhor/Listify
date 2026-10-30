import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'

import { FormField } from '@/components/shared/FormField'
import { PasswordInput } from '@/components/shared/PasswordInput'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRegister } from '@/features/auth/api'
import { AuthHeading, FormAlert } from '@/features/auth/components/AuthLayout'
import { MIN_PASSWORD_LENGTH, registerSchema, type RegisterValues } from '@/features/auth/schemas'
import { applyServerErrors } from '@/lib/form-errors'
import { browserTimezone } from '@/lib/timezones'

export function RegisterPage() {
  const navigate = useNavigate()
  const registerUser = useRegister()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', accept_terms: false },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async ({ accept_terms: _accepted, ...values }) => {
    setFormError(null)
    try {
      await registerUser.mutateAsync({ ...values, timezone: browserTimezone(), accept_terms: true })
      navigate('/welcome', { replace: true })
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError, ['name', 'email', 'password']))
    }
  })

  return (
    <>
      <AuthHeading
        title="Create your account"
        description="One account for your personal tasks and every team you work with."
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <FormField label="Full name" error={errors.name?.message}>
          <Input autoComplete="name" autoFocus {...form.register('name')} />
        </FormField>
        <FormField label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FormField>
        <FormField
          label="Password"
          error={errors.password?.message}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase works well.`}
        >
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2.5">
            <Controller
              control={form.control}
              name="accept_terms"
              render={({ field }) => (
                <Checkbox
                  id="accept-terms"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  aria-invalid={errors.accept_terms ? true : undefined}
                  aria-describedby={errors.accept_terms ? 'accept-terms-error' : undefined}
                  className="mt-0.5"
                />
              )}
            />
            <Label
              htmlFor="accept-terms"
              className="leading-snug font-normal text-muted-foreground"
            >
              I agree to the Terms of Service and Privacy Policy.
            </Label>
          </div>
          {errors.accept_terms ? (
            <p id="accept-terms-error" role="alert" className="text-sm text-destructive">
              {errors.accept_terms.message}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={registerUser.isPending}>
          {registerUser.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  )
}
