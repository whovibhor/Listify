import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { motion } from 'motion/react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PermissionDenied } from '@/features/organizations/components/OrganizationLayout'
import { useUpdateOrganization } from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import { useOrg } from '@/features/organizations/use-current-org'
import { applyServerErrors } from '@/lib/form-errors'
import { pageEnter } from '@/lib/motion'
import { timezoneOptions } from '@/lib/timezones'

const schema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(120),
  description: z.string().trim().max(500, 'Use at most 500 characters.'),
  website: z
    .string()
    .trim()
    .max(255)
    .refine((value) => !value || /^https?:\/\//i.test(value), 'Start with http:// or https://'),
  location: z.string().trim().max(120),
  timezone: z.string().min(1),
  is_discoverable: z.boolean(),
  review_required: z.boolean(),
})
type Values = z.infer<typeof schema>

function SettingSwitch({
  id,
  title,
  description,
  checked,
  onChange,
}: {
  id: string
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {title}
        </label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export function OrganizationSettingsPage() {
  const org = useOrg()
  const allowed = can(org, 'organization.settings.update')
  const update = useUpdateOrganization(org.id)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: org.name,
      description: org.description ?? '',
      website: org.website ?? '',
      location: org.location ?? '',
      timezone: org.timezone,
      is_discoverable: org.is_discoverable,
      review_required: org.review_required,
    },
  })
  const { errors, isDirty } = form.formState
  const zones = useMemo(() => {
    const options = timezoneOptions()
    return options.includes(org.timezone) ? options : [org.timezone, ...options]
  }, [org.timezone])

  if (!allowed) return <PermissionDenied />

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        ...values,
        description: values.description || null,
        website: values.website || null,
        location: values.location || null,
      })
      form.reset(values)
      toast.success('Settings saved')
    } catch (error) {
      const message = applyServerErrors(error, form.setError, [
        'name',
        'description',
        'website',
        'location',
        'timezone',
      ])
      if (message) toast.error(message)
    }
  })

  return (
    <motion.form
      {...pageEnter}
      onSubmit={onSubmit}
      noValidate
      className="mx-auto max-w-2xl space-y-5"
    >
      <PageHeader title="Settings" description="Your organization’s profile and policies." />
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            The timezone decides “today” and deadlines for organization reports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Organization name" error={errors.name?.message}>
            <Input maxLength={120} {...form.register('name')} />
          </FormField>
          <FormField label="Description" error={errors.description?.message}>
            <Textarea maxLength={500} className="min-h-20" {...form.register('description')} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Website" error={errors.website?.message}>
              <Input type="url" placeholder="https://" {...form.register('website')} />
            </FormField>
            <FormField label="Location" error={errors.location?.message}>
              <Input {...form.register('location')} />
            </FormField>
          </div>
          <FormField label="Timezone" error={errors.timezone?.message}>
            <NativeSelect {...form.register('timezone')}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Controller
            control={form.control}
            name="is_discoverable"
            render={({ field }) => (
              <SettingSwitch
                id="is-discoverable"
                title="Searchable by name"
                description="Anyone signed in can find this organization and ask to join. You still approve every request."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="review_required"
            render={({ field }) => (
              <SettingSwitch
                id="review-required"
                title="Require review before completing tasks"
                description="Team tasks must pass through In Review. Applies once department boards arrive."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={!isDirty || update.isPending}>
          {update.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Save changes
        </Button>
      </div>
    </motion.form>
  )
}
