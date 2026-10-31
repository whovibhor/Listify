import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MyOrganization } from '@/features/organizations/types'
import type { Task, TaskDetail } from '@/features/tasks/types'
import { emptyPage, mockApi, noContent, signedInRoutes, testUser } from '@/test/mock-api'
import { jsonResponse, renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const org: MyOrganization = {
  id: 7,
  name: 'Acme',
  slug: 'acme',
  description: null,
  website: null,
  location: null,
  timezone: 'Asia/Kolkata',
  is_discoverable: false,
  review_required: false,
  created_at: '2026-10-30T09:00:00Z',
  role_keys: ['owner'],
  permissions: ['task.view_all'],
  department_permissions: {},
  department_ids: [3],
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    parent_task_id: null,
    title: 'Fix the login page',
    description: 'Users are locked out.',
    status: 'in_progress',
    priority: 'high',
    start_at: null,
    due_at: null,
    due_all_day: false,
    is_overdue: false,
    completed_at: null,
    archived_at: null,
    created_at: '2026-10-30T09:00:00Z',
    updated_at: '2026-10-30T09:00:00Z',
    estimated_minutes: null,
    actual_minutes: null,
    tags: [],
    subtask_count: 0,
    subtasks_completed: 0,
    organization_id: 7,
    visibility: 'department',
    department: { id: 3, name: 'Engineering' },
    assignee: { id: 2, name: 'Eve Eng' },
    creator: { id: 1, name: 'Ada Lovelace' },
    collaborators: [],
    needs_reassignment: false,
    allowed_statuses: ['blocked', 'completed', 'cancelled'],
    actions: ['edit', 'assign', 'change_visibility', 'move', 'manage_collaborators', 'archive'],
    ...overrides,
  }
}

const detail = (task: Task): TaskDetail => ({ ...task, subtasks: [], visible_to: [] })

const eve = {
  membership_id: 21,
  user_id: 2,
  name: 'Eve Eng',
  email: 'eve@example.com',
  job_title: null,
  status: 'active',
  joined_at: '2026-10-01T09:00:00Z',
  roles: [],
  departments: [],
  actions: [],
}

const comment = {
  id: 5,
  task_id: 1,
  author: { id: 2, name: 'Eve Eng' },
  body: 'On it',
  deleted: false,
  edited: false,
  created_at: '2026-10-30T09:00:00Z',
  can_edit: false,
  can_delete: false,
}

function routes(task: Task, extra: Record<string, unknown> = {}) {
  return signedInRoutes({
    'GET /me/organizations': [org],
    'GET /organizations/7/departments': [],
    'GET /organizations/7/members': emptyPage([eve]),
    'GET /organizations/7/tags': [],
    'GET /organizations/7/tasks': emptyPage([task]),
    'GET /me/tags': [],
    'GET /tasks/1': detail(task),
    'GET /tasks/1/activity': [],
    'GET /tasks/1/comments': [],
    'GET /tasks/1/attachments': [],
    'GET /tasks/1/update-requests': [],
    ...extra,
  })
}

function renderTask(task: Task, extra: Record<string, unknown> = {}, path = '/org/7/tasks/1') {
  const api = mockApi(routes(task, extra))
  return { api, ...renderApp(path) }
}

function lastPatch(api: ReturnType<typeof mockApi>) {
  return api.calls.filter((call) => call.method === 'PATCH' && call.path === '/tasks/1').at(-1)
}

const sections = () => screen.findByRole('navigation', { name: 'Task sections' })

describe('task page', () => {
  it('shows the task, its people and its description', async () => {
    renderTask(makeTask({ collaborators: [{ id: 5, name: 'Lee Lead' }] }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fix the login page' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Users are locked out.')).toBeInTheDocument()
    const facts = screen.getByRole('region', { name: 'Task details' })
    expect(within(facts).getByText('Eve Eng')).toBeInTheDocument()
    expect(within(facts).getByText('Lee Lead')).toBeInTheDocument()
    expect(within(facts).getByText('Engineering')).toBeInTheDocument()
  })

  it('gives each section its own address, with counts', async () => {
    const { user, router } = renderTask(makeTask(), {
      'GET /tasks/1/comments': [comment, { ...comment, id: 6, deleted: true, body: null }],
    })

    const tabs = await sections()
    const comments = await within(tabs).findByRole('link', { name: 'Comments, 1' })
    expect(within(tabs).getByRole('link', { name: 'Update requests' })).toHaveAttribute(
      'href',
      '/org/7/tasks/1/requests',
    )

    await user.click(comments)

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1/comments'))
    expect(await screen.findByLabelText('Add a comment')).toBeInTheDocument()
  })

  it('opens directly on a section, and ignores one that doesn’t exist', async () => {
    const { router } = renderTask(makeTask(), {}, '/org/7/tasks/1/nonsense')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1'))
    expect(await screen.findByText('Users are locked out.')).toBeInTheDocument()
  })

  it('previews the latest comments on the overview', async () => {
    renderTask(makeTask(), { 'GET /tasks/1/comments': [comment] })

    expect(await screen.findByText('On it')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All comments' })).toHaveAttribute(
      'href',
      '/org/7/tasks/1/comments',
    )
  })

  it('says when a task doesn’t exist or isn’t yours to see', async () => {
    renderTask(makeTask(), {
      'GET /tasks/1': () =>
        jsonResponse(
          { error: { code: 'not_found', message: 'Task not found.', details: [] } },
          404,
        ),
    })

    expect(await screen.findByText('Task not found')).toBeInTheDocument()
  })
})

describe('getting to a task', () => {
  it('opens from a list, and Back returns with the filters on', async () => {
    const { user, router } = renderTask(makeTask(), {}, '/org/7/tasks?overdue=true')

    await user.click(await screen.findByRole('link', { name: 'Fix the login page' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1'))

    await user.click(await screen.findByRole('link', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks'))
    expect(router.state.location.search).toBe('?overdue=true')
  })

  it('keeps Back working while moving between sections', async () => {
    const { user, router } = renderTask(makeTask(), {}, '/org/7/tasks?overdue=true')

    await user.click(await screen.findByRole('link', { name: 'Fix the login page' }))
    await user.click(await within(await sections()).findByRole('link', { name: 'Activity' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1/activity'))
    await user.click(screen.getByRole('link', { name: 'Back' }))

    await waitFor(() => expect(router.state.location.search).toBe('?overdue=true'))
  })

  it('falls back to the list when opened from a shared link', async () => {
    renderTask(makeTask())

    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/org/7/tasks',
    )
  })

  it('sends old panel links to the page', async () => {
    const { router } = renderTask(makeTask(), {}, '/org/7/boards/3?task=1')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1'))
    expect(router.state.location.search).toBe('')
  })

  it('corrects a link that names the wrong workspace', async () => {
    const { router } = renderTask(makeTask(), {}, '/personal/tasks/1')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1'))
  })
})

describe('quick actions', () => {
  it('changes the status in one click, without Edit', async () => {
    const task = makeTask()
    const { user, api } = renderTask(task, {
      'POST /tasks/1/complete': detail({ ...task, status: 'completed' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Complete' }))

    await waitFor(() =>
      expect(api.calls.some((call) => call.path === '/tasks/1/complete')).toBe(true),
    )
  })

  it('offers no Complete where review stands in the way', async () => {
    renderTask(makeTask({ allowed_statuses: ['in_review'] }))

    await screen.findByRole('button', { name: 'More actions' })
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
  })

  it('archives organization tasks, never deletes them, and goes back', async () => {
    const task = makeTask()
    const { user, router } = renderTask(task, {
      'POST /tasks/1/archive': detail({ ...task, archived_at: '2026-10-31T09:00:00Z' }),
    })

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks'))
  })
})

describe('editing', () => {
  it('saves only what changed, when Save is pressed', async () => {
    const task = makeTask()
    const { user, api } = renderTask(task, { 'PATCH /tasks/1': detail(task) })

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    const title = within(form).getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Fix sign-in')
    expect(lastPatch(api)).toBeUndefined()
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(lastPatch(api)?.body).toEqual({ title: 'Fix sign-in' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reassigns through the form', async () => {
    const task = makeTask({ assignee: null })
    const { user, api } = renderTask(task, { 'PATCH /tasks/1': detail(task) })

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    await user.selectOptions(
      within(form).getByLabelText('Assignee'),
      await within(form).findByRole('option', { name: 'Eve Eng' }),
    )
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(lastPatch(api)?.body).toEqual({ assigned_to: 2 }))
  })

  it('adds a collaborator through the form', async () => {
    const task = makeTask({ assignee: null })
    const { user, api } = renderTask(task, { 'POST /tasks/1/collaborators': detail(task) })

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    await user.click(within(form).getByRole('button', { name: 'Add collaborator' }))
    await user.click(await screen.findByRole('button', { name: 'Eve Eng' }))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.calls.find((call) => call.path === '/tasks/1/collaborators')?.body).toEqual({
        user_id: 2,
      }),
    )
  })

  it('changes nothing on Cancel', async () => {
    const { user, api } = renderTask(makeTask())

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    await user.type(within(form).getByLabelText('Title'), ' again')
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch(api)).toBeUndefined()
  })

  it('shows only the fields this person may change', async () => {
    const { user } = renderTask(makeTask({ actions: ['assign'] }))

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    expect(within(form).getByLabelText('Assignee')).toBeInTheDocument()
    expect(within(form).queryByLabelText('Title')).not.toBeInTheDocument()
    expect(within(form).queryByLabelText('Department')).not.toBeInTheDocument()
  })

  it('keeps the form open and explains when the server refuses', async () => {
    const { user } = renderTask(makeTask(), {
      'PATCH /tasks/1': () =>
        jsonResponse(
          { error: { code: 'validation', message: 'That date doesn’t work.', details: [] } },
          422,
        ),
    })

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    await user.type(within(form).getByLabelText('Title'), ' again')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('That date doesn’t work.')
  })
})

describe('tasks the viewer can only read', () => {
  it('says so, and offers nothing that would fail', async () => {
    renderTask(makeTask({ allowed_statuses: [], actions: [] }))

    expect(
      await screen.findByText('You can view this task, but not change it.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument()
  })

  it('still lets someone pick up unassigned work', async () => {
    const task = makeTask({ assignee: null, allowed_statuses: [], actions: [] })
    const { user, api } = renderTask(task, { 'PATCH /tasks/1': detail(task) })

    await user.click(await screen.findByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(lastPatch(api)?.body).toEqual({ assigned_to: testUser.id }))
  })

  it('makes an archived task read-only, with Restore', async () => {
    const task = makeTask({ archived_at: '2026-10-31T09:00:00Z' })
    const { user } = renderTask(task)

    expect(await screen.findByText(/archived and read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Restore' })).toBeInTheDocument()
  })

  it('explains a task that needs a new assignee', async () => {
    renderTask(makeTask({ needs_reassignment: true }))

    expect(await screen.findByText(/Eve Eng can no longer work on this task/)).toBeInTheDocument()
  })
})

describe('subtasks', () => {
  const parent = makeTask({ id: 9, title: 'Launch the site' })
  const subtask = makeTask({ parent_task_id: 9, title: 'Write the copy' })

  it('opens from its parent, and links back to it', async () => {
    const child = makeTask({ id: 2, parent_task_id: 1, title: 'Write the copy' })
    const { user, router } = renderTask(makeTask(), {
      'GET /tasks/1': { ...detail(makeTask({ subtask_count: 1 })), subtasks: [child] },
      'GET /tasks/2': detail(child),
      'GET /tasks/2/activity': [],
    })

    await user.click(await screen.findByRole('link', { name: 'Write the copy' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/2'))
    expect(await screen.findByRole('link', { name: 'Fix the login page' })).toHaveAttribute(
      'href',
      '/org/7/tasks/1',
    )
  })

  it('has only the sections the server keeps for subtasks', async () => {
    const { api } = renderTask(subtask, { 'GET /tasks/9': detail(parent) })

    const tabs = await sections()
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Overview', 'Activity'])
    expect(api.calls.some((call) => call.path === '/tasks/1/comments')).toBe(false)
    expect(screen.queryByText('Latest comments')).not.toBeInTheDocument()
  })

  it('takes its people from the parent, so doesn’t offer to change them', async () => {
    const { user } = renderTask(makeTask({ ...subtask, assignee: null }), {
      'GET /tasks/9': detail(parent),
    })

    expect(await screen.findByText(/come from the parent task/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
    expect(screen.queryByText('Visibility')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog')
    expect(within(form).getByLabelText('Title')).toBeInTheDocument()
    expect(within(form).queryByLabelText('Assignee')).not.toBeInTheDocument()
  })

  it('offers Delete only to people who can edit it', async () => {
    const { user } = renderTask(makeTask({ ...subtask, actions: [] }), {
      'GET /tasks/9': detail(parent),
    })

    await user.click(await screen.findByRole('button', { name: 'More actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('can be deleted, and returns to its parent', async () => {
    const { user, router } = renderTask(subtask, {
      'GET /tasks/9': detail(parent),
      'DELETE /tasks/1': noContent,
    })

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/9'))
  })
})

describe('personal tasks', () => {
  const personal = makeTask({
    organization_id: null,
    department: null,
    assignee: null,
    creator: null,
    visibility: 'private',
    allowed_statuses: [],
    actions: [],
  })

  it('use the same page, without people or update requests', async () => {
    renderTask(personal, {}, '/personal/tasks/1')

    const tabs = await sections()
    expect(within(tabs).queryByRole('link', { name: /Update requests/ })).not.toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: /Files/ })).toBeInTheDocument()
    expect(screen.queryByText('Assignee')).not.toBeInTheDocument()
    expect(screen.queryByText('Visibility')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('can be deleted after confirming', async () => {
    const { user, api, router } = renderTask(
      personal,
      { 'DELETE /tasks/1': noContent },
      '/personal/tasks/1',
    )

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/personal/tasks'))
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(true)
  })
})
