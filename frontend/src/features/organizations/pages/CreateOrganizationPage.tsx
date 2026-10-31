import { useState, type KeyboardEvent } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Building2Icon, Loader2Icon, PlusIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'

import { FormField } from '@/components/shared/FormField'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/features/auth/api'
import { useCreateOrganization } from '@/features/organizations/api'
import { TagChip } from '@/features/tasks/components/TagChip'
import { applyServerErrors } from '@/lib/form-errors'
import { pageEnter } from '@/lib/motion'

const schema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(120),
  description: z.string().trim().max(500, 'Use at most 500 characters.'),
  website: z
    .string()
    .trim()
    .max(255)
    .refine((value) => !value || /^https?:\/\//i.test(value), 'Start with http:// or https://'),
  location: z.string().trim().max(120),
  is_discoverable: z.boolean(),
})
type Values = z.infer<typeof schema>

const SUGGESTED = ['Engineering', 'Sales', 'Operations', 'HR']

export function CreateOrganizationPage() {
  const navigate = useNavigate()
  const { data: user } = useMe()
  const create = useCreateOrganization()
  const [departments, setDepartments] = useState<string[]>([])
  const [departmentName, setDepartmentName] = useState('')
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', website: '', location: '', is_discoverable: false },
  })
  const { errors } = form.formState

  const addDepartment = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const exists = departments.some((d) => d.toLowerCase() === trimmed.toLowerCase())
    if (exists) toast.error(`“${trimmed}” is already in the list.`)
    else setDepartments([...departments, trimmed])
    setDepartmentName('')
  }

  const onDepartmentKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      addDepartment(departmentName)
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const organization = await create.mutateAsync({
        ...values,
        description: values.description || undefined,
        website: values.website || undefined,
        location: values.location || undefined,
        timezone: user?.timezone,
        departments: departments.map((name) => ({ name })),
      })
      toast.success(`${organization.name} is ready`, { description: 'You are its Owner.' })
      navigate(`/org/${organization.id}`, { replace: true })
    } catch (error) {
      const message = applyServerErrors(error, form.setError, [
        'name',
        'description',
        'website',
        'location',
      ])
      if (message) toast.error(message)
    }
  })

  return (
    <motion.form
      {...pageEnter}
      onSubmit={onSubmit}
      noValidate
      className="mx-auto max-w-2xl space-y-4"
    >
      <PageHeader
        title="Create an organization"
        description="A shared workspace for your team. Your personal tasks stay private and separate."
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Only the name is required. You can change all of this later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Organization name" error={errors.name?.message}>
            <Input autoFocus maxLength={120} {...form.register('name')} />
          </FormField>
          <FormField label="Description" error={errors.description?.message}>
            <Textarea maxLength={500} className="min-h-20" {...form.register('description')} />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Website" error={errors.website?.message}>
              <Input type="url" placeholder="https://" {...form.register('website')} />
            </FormField>
            <FormField label="Location" error={errors.location?.message}>
              <Input {...form.register('location')} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          <CardDescription>
            Teams inside your organization. Each gets its own members and, soon, its own work board.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {departments.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {departments.map((name) => (
                <li key={name}>
                  <TagChip
                    tag={{ id: 0, name, color: 'violet' }}
                    onRemove={() => setDepartments(departments.filter((d) => d !== name))}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input
              aria-label="Department name"
              placeholder="Add a department"
              value={departmentName}
              maxLength={100}
              onChange={(event) => setDepartmentName(event.target.value)}
              onKeyDown={onDepartmentKey}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!departmentName.trim()}
              onClick={() => addDepartment(departmentName)}
            >
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Suggestions:
            {SUGGESTED.filter((name) => !departments.includes(name)).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => addDepartment(name)}
                className="rounded-md bg-muted px-2 py-1 font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <label htmlFor="discoverable" className="text-sm font-medium">
              Let people find this organization
            </label>
            <p id="discoverable-help" className="text-sm text-muted-foreground">
              When on, anyone signed in can search for it by name and ask to join. You still approve
              every request. When off, people can only join with an invitation.
            </p>
          </div>
          <Controller
            control={form.control}
            name="is_discoverable"
            render={({ field }) => (
              <Switch
                id="discoverable"
                aria-describedby="discoverable-help"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <Building2Icon data-icon="inline-start" />
          )}
          Create organization
        </Button>
      </div>
    </motion.form>
  )
}
