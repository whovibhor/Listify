import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskAttachment, TaskComment, UpdateRequest } from '@/features/collaboration/types'
import type { InboxNotification } from '@/features/inbox/types'
import { describeNotification } from '@/features/inbox/types'
import type { MyOrganization } from '@/features/organizations/types'
import type { Task, TaskDetail } from '@/features/tasks/types'
import { jsonResponse, renderApp } from '@/test/render'
import { emptyPage, mockApi, noContent, signedInRoutes } from '@/test/mock-api'

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
  role_keys: ['team_lead'],
  permissions: ['member.view', 'task.create'],
  department_permissions: {},
  department_ids: [3],
}

const task: Task = {
  id: 1,
  parent_task_id: null,
  title: 'Fix the login page',
  description: null,
  status: 'in_progress',
  priority: 'medium',
  start_at: null,
  due_at: null,
  due_all_day: true,
  is_overdue: false,
  completed_at: null,
  archived_at: null,
  created_at: '2026-10-29T09:00:00Z',
  updated_at: '2026-10-29T09:00:00Z',
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
  allowed_statuses: ['blocked', 'completed'],
  actions: ['edit', 'assign', 'request_update'],
}

const detail: TaskDetail = { ...task, subtasks: [], visible_to: [] }

const comment: TaskComment = {
  id: 5,
  task_id: 1,
  author: { id: 1, name: 'Ada Lovelace' },
  body: 'Second thoughts\non this',
  deleted: false,
  edited: false,
  created_at: '2026-10-30T09:00:00Z',
  can_edit: true,
  can_delete: true,
}

const attachment: TaskAttachment = {
  id: 9,
  task_id: 1,
  filename: 'plan.pdf',
  content_type: 'application/pdf',
  size_bytes: 2048,
  uploaded_by: { id: 1, name: 'Ada Lovelace' },
  created_at: '2026-10-30T09:00:00Z',
  can_delete: true,
}

const request: UpdateRequest = {
  id: 4,
  task_id: 1,
  requester: { id: 5, name: 'Lee Lead' },
  recipient: { id: 1, name: 'Ada Lovelace' },
  message: 'How is it going?',
  respond_by: null,
  status: 'pending',
  response_note: null,
  responded_at: null,
  created_at: '2026-10-30T09:00:00Z',
  can_respond: true,
  can_cancel: false,
}

const routes = {
  'GET /me/organizations': [org],
  'GET /organizations/7/departments': [],
  'GET /organizations/7/members': emptyPage(),
  'GET /organizations/7/tags': [],
  'GET /organizations/7/tasks': emptyPage([task]),
  'GET /tasks/1': detail,
  'GET /tasks/1/activity': [],
  'GET /tasks/1/comments': [comment],
  'GET /tasks/1/attachments': [attachment],
  'GET /tasks/1/update-requests': [request],
}

let section = 'comments'

function renderTask(extra: Record<string, unknown> = {}) {
  const api = mockApi(signedInRoutes({ ...routes, ...extra }))
  return { api, ...renderApp(`/org/7/tasks/1/${section}`) }
}

function lastCall(api: ReturnType<typeof mockApi>, method: string, path: string) {
  return api.calls.filter((call) => call.method === method && call.path === path).at(-1)
}

describe('comments', () => {
  beforeEach(() => {
    section = 'comments'
  })

  it('shows text exactly as written, never as HTML', async () => {
    renderTask({
      'GET /tasks/1/comments': [{ ...comment, body: '<img src=x onerror=alert(1)>' }],
    })
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('adds a comment with a mention', async () => {
    const person = { user_id: 2, name: 'Eve Eng' }
    const { user, api } = renderTask({
      'GET /organizations/7/members': emptyPage([person]),
      'POST /tasks/1/comments': comment,
    })
    const panel = await screen.findByRole('main')
    await user.type(await within(panel).findByLabelText('Add a comment'), 'Please check')
    await user.click(within(panel).getByRole('button', { name: 'Mention' }))
    await user.click(await screen.findByRole('button', { name: 'Eve Eng' }))
    await user.click(within(panel).getByRole('button', { name: 'Comment' }))

    await waitFor(() =>
      expect(lastCall(api, 'POST', '/tasks/1/comments')?.body).toEqual({
        body: 'Please check',
        mention_user_ids: [2],
      }),
    )
  })

  it('edits and deletes your own comment', async () => {
    const { user, api } = renderTask({
      'PATCH /comments/5': comment,
      'DELETE /comments/5': noContent,
    })
    const panel = await screen.findByRole('main')
    await user.click(await within(panel).findByRole('button', { name: 'Edit your comment' }))
    const box = within(panel).getByLabelText('Edit comment')
    await user.clear(box)
    await user.type(box, 'Better wording')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(lastCall(api, 'PATCH', '/comments/5')?.body).toEqual({ body: 'Better wording' }),
    )

    await user.click(
      await within(panel).findByRole('button', { name: 'Delete comment by Ada Lovelace' }),
    )
    await waitFor(() => expect(lastCall(api, 'DELETE', '/comments/5')).toBeDefined())
  })

  it('shows a deleted comment without its text', async () => {
    renderTask({
      'GET /tasks/1/comments': [
        { ...comment, body: null, deleted: true, can_edit: false, can_delete: false },
      ],
    })
    expect(await screen.findByText('This comment was deleted.')).toBeInTheDocument()
  })
})

describe('attachments', () => {
  beforeEach(() => {
    section = 'files'
  })

  it('links to the protected download, and offers delete only when allowed', async () => {
    renderTask({ 'GET /tasks/1/attachments': [{ ...attachment, can_delete: false }] })
    const link = await screen.findByRole('link', { name: 'Download plan.pdf' })
    expect(link).toHaveAttribute('href', '/api/v1/attachments/9/download')
    expect(screen.queryByRole('button', { name: 'Delete plan.pdf' })).not.toBeInTheDocument()
  })

  it('uploads the raw file with its name', async () => {
    const { user, api } = renderTask({ 'POST /tasks/1/attachments': attachment })
    const panel = await screen.findByRole('main')
    const input = await within(panel).findByLabelText('Choose files to attach')
    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }))

    await waitFor(() => {
      const call = lastCall(api, 'POST', '/tasks/1/attachments')
      expect(call?.query.get('filename')).toBe('notes.txt')
    })
  })

  it('stops a file over 10 MB before sending it', async () => {
    const { user, api } = renderTask()
    const panel = await screen.findByRole('main')
    const input = await within(panel).findByLabelText('Choose files to attach')
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    await user.upload(input, big)

    expect(await screen.findByText('huge.pdf is larger than 10 MB.')).toBeInTheDocument()
    expect(lastCall(api, 'POST', '/tasks/1/attachments')).toBeUndefined()
  })

  it('offers no upload on a task the viewer can only read', async () => {
    renderTask({ 'GET /tasks/1': { ...detail, actions: [], allowed_statuses: [] } })
    const panel = await screen.findByRole('main')
    await within(panel).findByRole('link', { name: 'Download plan.pdf' })
    expect(within(panel).queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument()
  })
})

describe('update requests', () => {
  beforeEach(() => {
    section = 'requests'
  })

  it('sends a request to someone on the task', async () => {
    const { user, api } = renderTask({
      'GET /tasks/1/update-requests': [],
      'POST /tasks/1/update-requests': request,
    })
    const panel = await screen.findByRole('main')
    await user.click(await within(panel).findByRole('button', { name: 'Request an update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request an update' })
    await user.type(within(dialog).getByLabelText(/What would you like/), 'Any news?')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))

    await waitFor(() =>
      expect(lastCall(api, 'POST', '/tasks/1/update-requests')?.body).toEqual({
        recipient_id: 2,
        message: 'Any news?',
        respond_by: null,
      }),
    )
  })

  it('hides Request an update from people who may not ask', async () => {
    renderTask({ 'GET /tasks/1': { ...detail, actions: ['edit'] } })
    const panel = await screen.findByRole('main')
    await within(panel).findByText('How is it going?')
    expect(
      within(panel).queryByRole('button', { name: 'Request an update' }),
    ).not.toBeInTheDocument()
  })

  it('responds, optionally changing the status', async () => {
    const { user, api } = renderTask({
      'POST /update-requests/4/respond': { ...request, status: 'responded' },
    })
    const panel = await screen.findByRole('main')
    await user.click(await within(panel).findByRole('button', { name: 'Respond' }))
    const dialog = await screen.findByRole('dialog', { name: 'Respond to Lee Lead' })
    await user.type(within(dialog).getByLabelText('Your update'), 'Almost done')
    await user.selectOptions(within(dialog).getByLabelText(/Change status/), 'blocked')
    await user.click(within(dialog).getByRole('button', { name: 'Send response' }))

    await waitFor(() =>
      expect(lastCall(api, 'POST', '/update-requests/4/respond')?.body).toEqual({
        response_note: 'Almost done',
        status: 'blocked',
      }),
    )
  })
})

describe('inbox', () => {
  const item: InboxNotification = {
    id: 3,
    type: 'assigned',
    read: false,
    created_at: '2026-10-30T09:00:00Z',
    accessible: true,
    actor_name: 'Lee Lead',
    organization_id: 7,
    task: { id: 1, title: 'Fix the login page', organization_id: 7 },
    data: {},
  }
  const inboxRoutes = {
    'GET /inbox': emptyPage([item]),
    'GET /inbox/summary': { unread: 1, pending_update_requests: 0, other_workspaces: 0 },
    'GET /me/update-requests': [],
  }

  it('opens the task and marks the notification read', async () => {
    const api = mockApi(
      signedInRoutes({ ...routes, ...inboxRoutes, 'POST /notifications/3/read': noContent }),
    )
    const { user, router } = renderApp('/org/7/inbox')
    await user.click(await screen.findByRole('button', { name: /Lee Lead assigned you/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/tasks/1'))
    expect(lastCall(api, 'POST', '/notifications/3/read')).toBeDefined()
  })

  it('shows nothing about an item the person can no longer see', async () => {
    mockApi(
      signedInRoutes({
        ...routes,
        ...inboxRoutes,
        'GET /inbox': emptyPage([
          { ...item, accessible: false, actor_name: null, organization_id: null, task: null },
        ]),
        'POST /notifications/3/read': noContent,
      }),
    )
    const { user, router } = renderApp('/org/7/inbox')
    const row = await screen.findByRole('button', { name: /You no longer have access/ })
    expect(row).not.toHaveTextContent('Lee Lead')
    await user.click(row)
    expect(router.state.location.pathname).toBe('/org/7/inbox')
  })

  it('shows the unread count on the bell', async () => {
    mockApi(signedInRoutes({ ...routes, ...inboxRoutes }))
    renderApp('/org/7/inbox')
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('lists updates to answer and marks everything read', async () => {
    const api = mockApi(
      signedInRoutes({
        ...routes,
        ...inboxRoutes,
        'GET /me/update-requests': [
          {
            ...request,
            task_title: 'Fix the login page',
            organization_id: 7,
            allowed_statuses: ['blocked'],
          },
        ],
        'POST /notifications/read-all': noContent,
      }),
    )
    const { user } = renderApp('/org/7/inbox')
    expect(await screen.findByText('Waiting for your update')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    await waitFor(() =>
      expect(lastCall(api, 'POST', '/notifications/read-all')?.query.get('workspace')).toBe('7'),
    )
  })

  it('filters by kind', async () => {
    const api = mockApi(signedInRoutes({ ...routes, ...inboxRoutes }))
    const { user } = renderApp('/org/7/inbox')
    await user.click(await screen.findByRole('button', { name: 'Assignments' }))
    await waitFor(() =>
      expect(lastCall(api, 'GET', '/inbox')?.query.get('filter')).toBe('assignments'),
    )
  })

  it('asks only for this workspace', async () => {
    const api = mockApi(signedInRoutes({ ...routes, ...inboxRoutes }))
    renderApp('/org/7/inbox')

    await screen.findByRole('button', { name: /Lee Lead assigned you/ })
    expect(lastCall(api, 'GET', '/inbox')?.query.get('workspace')).toBe('7')
    expect(lastCall(api, 'GET', '/inbox/summary')?.query.get('workspace')).toBe('7')
    expect(lastCall(api, 'GET', '/me/update-requests')?.query.get('workspace')).toBe('7')
  })

  it('stays in the organization, with its sidebar, on the bell and the Inbox link', async () => {
    mockApi(signedInRoutes({ ...routes, ...inboxRoutes }))
    const { user, router } = renderApp('/org/7/tasks')

    await user.click(await screen.findByRole('link', { name: 'Notifications, 1 unread' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/inbox'))
    expect(await screen.findByRole('link', { name: 'Switch to Personal' })).toBeInTheDocument()
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(within(nav).getByRole('link', { name: /team tasks/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /inbox/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('keeps Personal apart: no organization page to open from there', async () => {
    const api = mockApi(
      signedInRoutes({
        ...routes,
        ...inboxRoutes,
        'GET /inbox': emptyPage([
          {
            ...item,
            type: 'membership_approved',
            task: null,
            data: { organization_name: 'Old Org' },
          },
        ]),
        'POST /notifications/3/read': noContent,
      }),
    )
    const { user, router } = renderApp('/inbox')

    await user.click(await screen.findByRole('button', { name: /join Old Org/ }))

    await waitFor(() => expect(lastCall(api, 'POST', '/notifications/3/read')).toBeDefined())
    expect(router.state.location.pathname).toBe('/inbox')
    expect(lastCall(api, 'GET', '/inbox')?.query.get('workspace')).toBe('personal')
    expect(screen.getByRole('link', { name: 'Switch to Acme' })).toBeInTheDocument()
  })

  it('offers only the filters that apply in Personal', async () => {
    mockApi(signedInRoutes({ ...routes, ...inboxRoutes, 'GET /inbox': emptyPage() }))
    renderApp('/inbox')

    expect(await screen.findByRole('button', { name: 'Unread' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assignments' })).not.toBeInTheDocument()
    expect(await screen.findByText(/notices are in their own inboxes/)).toBeInTheDocument()
  })

  it('never falls back to raw type names', () => {
    expect(describeNotification({ ...item, type: 'something_new' })).toBe('Something changed')
    expect(
      describeNotification({
        ...item,
        type: 'membership_removed',
        data: { organization_name: 'Acme' },
      }),
    ).toBe('You were removed from Acme')
  })
})

describe('failures', () => {
  beforeEach(() => {
    section = 'files'
  })

  it('explains a refused upload', async () => {
    const { user } = renderTask({
      'POST /tasks/1/attachments': () =>
        jsonResponse(
          {
            error: {
              code: 'attachment_rejected',
              message: "This type of file can't be attached.",
              details: [],
              request_id: null,
            },
          },
          422,
        ),
    })
    const panel = await screen.findByRole('main')
    const input = await within(panel).findByLabelText('Choose files to attach')
    await user.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText("This type of file can't be attached.")).toBeInTheDocument()
  })
})
