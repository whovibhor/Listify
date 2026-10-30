import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon, MailCheckIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'

import { FormField } from '@/components/shared/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useForgotPassword } from '@/features/auth/api'
import { AuthHeading, FormAlert } from '@/features/auth/components/AuthLayout'
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/features/auth/schemas'
import { applyServerErrors } from '@/lib/form-errors'
import { pageEnter } from '@/lib/motion'

function BackToSignIn() {
  return (
    <Link
      to="/login"
      className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      Back to sign in
    </Link>
  )
}

export function ForgotPasswordPage() {
  const forgot = useForgotPassword()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await forgot.mutateAsync(values)
      setSentTo(values.email)
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError, ['email']))
    }
  })

  if (sentTo) {
    return (
      <motion.div {...pageEnter} role="status">
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-accent text-accent-foreground">
          <MailCheckIcon aria-hidden className="size-5" />
        </span>
        <AuthHeading
          title="Check your email"
          description={`If an account exists for ${sentTo}, we've sent a link to reset your password. It expires in 60 minutes.`}
        />
        <BackToSignIn />
      </motion.div>
    )
  }

  return (
    <>
      <AuthHeading
        title="Reset your password"
        description="Enter the email you signed up with and we'll send you a reset link."
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <FormField label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={forgot.isPending}>
          {forgot.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Send reset link
        </Button>
      </form>
      <BackToSignIn />
    </>
  )
}
