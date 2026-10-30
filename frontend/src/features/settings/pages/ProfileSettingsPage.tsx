import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useMe, useUpdateProfile, type User } from '@/features/auth/api'
import { profileSchema, type ProfileValues } from '@/features/auth/schemas'
import { applyServerErrors } from '@/lib/form-errors'
import { browserTimezone, timezoneOptions } from '@/lib/timezones'

function ProfileForm({ user }: { user: User }) {
  const update = useUpdateProfile()
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name, timezone: user.timezone },
  })
  const { errors, isDirty } = form.formState
  const selectedTimezone = useWatch({ control: form.control, name: 'timezone' })
  const zones = useMemo(() => {
    const options = timezoneOptions()
    return options.includes(user.timezone) ? options : [user.timezone, ...options]
  }, [user.timezone])
  const detected = browserTimezone()

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      form.reset({ name: saved.name, timezone: saved.timezone })
      toast.success('Profile saved')
    } catch (error) {
      const message = applyServerErrors(error, form.setError, ['name', 'timezone'])
      if (message) toast.error(message)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormField label="Full name" error={errors.name?.message}>
        <Input autoComplete="name" {...form.register('name')} />
      </FormField>
      <FormField label="Email" hint="Changing your email isn't available yet.">
        <Input value={user.email} readOnly disabled />
      </FormField>
      <FormField
        label="Timezone"
        error={errors.timezone?.message}
        hint="Used for due dates, “My Day” and your dashboard."
        labelAside={
          detected !== selectedTimezone ? (
            <button
              type="button"
              onClick={() => form.setValue('timezone', detected, { shouldDirty: true })}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Use detected ({detected})
            </button>
          ) : undefined
        }
      >
        <NativeSelect {...form.register('timezone')}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || update.isPending}>
          {update.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Save changes
        </Button>
      </div>
    </form>
  )
}

export function ProfileSettingsPage() {
  const { data: user } = useMe()
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          How you appear to teammates and how dates are shown to you.
        </CardDescription>
      </CardHeader>
      <CardContent>{user ? <ProfileForm user={user} /> : null}</CardContent>
    </Card>
  )
}
