import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Member, MyOrganization } from '@/features/organizations/types'
import type { TaskStatus } from '@/features/tasks/task-meta'
import type { Task, TaskDetail } from '@/features/tasks/types'
import type { Board } from '@/features/work/types'
import { jsonResponse, renderApp } from '@/test/render'
import { emptyPage, mockApi, signedInRoutes } from '@/test/mock-api'

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
  role_keys: ['member'],
  permissions: ['member.view', 'task.create'],
  department_permissions: {},
  department_ids: [3],
}

const admin: MyOrganization = {
  ...org,
  role_keys: ['admin'],
  permissions: [...org.permissions, 'task.view_all', 'member.manage'],
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    parent_task_id: null,
    title: 'Fix the login page',
    description: null,
    status: 'not_started',
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
    allowed_statuses: ['in_progress', 'completed', 'cancelled'],
    actions: ['edit', 'assign', 'change_visibility', 'manage_collaborators', 'archive'],
    ...overrides,
  }
}

const detail = (task: Task): TaskDetail => ({ ...task, subtasks: [], visible_to: [] })

function makeBoard(tasks: Task[], overrides: Partial<Board> = {}): Board {
  const statuses: TaskStatus[] = [
    'not_started',
    'in_progress',
    'blocked',
    'in_review',
    'completed',
    'cancelled',
  ]
  return {
    department: { id: 3, name: 'Engineering' },
    archived: false,
    review_required: false,
    can_create: true,
    columns: statuses.map((status) => {
      const items = tasks.filter((task) => task.status === status)
      return { status, total: items.length, older: 0, items }
    }),
    ...overrides,
  }
}

const eve: Member = {
  membership_id: 21,
  user_id: 2,
  name: 'Eve Eng',
  email: 'eve@example.com',
  job_title: null,
  status: 'active',
  joined_at: '2026-10-30T09:00:00Z',
  roles: [{ key: 'member', name: 'Member', department_id: null }],
  departments: [{ id: 3, name: 'Engineering' }],
  actions: [],
}

const routes = {
  'GET /me/organizations': [org],
  'GET /organizations/7/departments': [
    {
      id: 3,
      organization_id: 7,
      name: 'Engineering',
      description: null,
      status: 'active',
      open_for_join_requests: true,
      member_count: 2,
    },
  ],
  'GET /organizations/7/members': emptyPage([eve]),
  'GET /organizations/7/tags': [],
  'GET /organizations/7/tasks': emptyPage(),
}

function lastCall(api: ReturnType<typeof mockApi>, method: string, path: string) {
  return api.calls.filter((call) => call.method === method && call.path === path).at(-1)
}

function renderBoardAt(path: string) {
  mockApi(
    signedInRoutes({
      ...routes,
      'GET /organizations/7/departments/3/board': makeBoard([]),
    }),
  )
  return renderApp(path)
}

function renderBoard(tasks: Task[], extra: Record<string, unknown> = {}, boardOverrides = {}) {
  const api = mockApi(
    signedInRoutes({
      ...routes,
      'GET /organizations/7/departments/3/board': makeBoard(tasks, boardOverrides),
      ...extra,
    }),
  )
  return { api, ...renderApp('/org/7/boards/3') }
}

describe('finished work', () => {
  const listCall = (api: ReturnType<typeof mockApi>) =>
    lastCall(api, 'GET', '/organizations/7/tasks')?.query

  it('Team Tasks opens on active work, and shows the rest on request', async () => {
    const api = mockApi(signedInRoutes({ ...routes }))
    const { user } = renderApp('/org/7/tasks')

    const toggle = await screen.findByRole('button', { name: 'Show finished' })
    await waitFor(() => expect(listCall(api)?.get('active')).toBe('true'))
    expect(await screen.findByText('No active tasks')).toBeInTheDocument()

    await user.click(toggle)

    await waitFor(() => expect(listCall(api)?.has('active')).toBe(false))
  })

  it('searching Team Tasks includes finished work', async () => {
    const api = mockApi(signedInRoutes({ ...routes }))
    renderApp('/org/7/tasks?q=invoice')

    await screen.findByRole('button', { name: 'Show finished' })
    await waitFor(() => expect(listCall(api)?.get('q')).toBe('invoice'))
    expect(listCall(api)?.has('active')).toBe(false)
  })

  it('the archive isn’t filtered by whether tasks are finished', async () => {
    const api = mockApi(signedInRoutes({ ...routes }))
    renderApp('/org/7/tasks?archived=true')

    expect(await screen.findByRole('button', { name: 'Show finished' })).toBeDisabled()
    await waitFor(() => expect(listCall(api)?.get('view')).toBe('archived'))
    expect(listCall(api)?.has('active')).toBe(false)
  })

  it('My Work adds finished tasks on request, latest deadline first', async () => {
    const api = mockApi(signedInRoutes({ ...routes }))
    const { user } = renderApp('/org/7/my-work')

    await user.click(await screen.findByRole('button', { name: 'Show finished' }))

    await waitFor(() => expect(listCall(api)?.getAll('status')).toContain('completed'))
    expect(listCall(api)?.get('sort')).toBe('-due')
  })

  it('the board’s List view opens on active work too', async () => {
    const api = mockApi(
      signedInRoutes({
        ...routes,
        'GET /organizations/7/departments/3/board': makeBoard([]),
      }),
    )
    const { user } = renderApp('/org/7/boards/3?layout=list')

    await user.click(await screen.findByRole('button', { name: 'Show finished' }))

    await waitFor(() => expect(listCall(api)?.has('active')).toBe(false))
  })
})

describe('department board', () => {
  it('shows the columns and what matters on each card', async () => {
    renderBoard([
      makeTask({
        title: 'Rewrite search',
        status: 'in_progress',
        priority: 'urgent',
        needs_reassignment: true,
      }),
    ])
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Engineering' }),
    ).toBeInTheDocument()
    const column = await screen.findByRole('region', { name: 'In progress, 1 tasks' })
    expect(within(column).getByText('Rewrite search')).toBeInTheDocument()
    expect(within(column).getByText('Urgent')).toBeInTheDocument()
    expect(within(column).getByText('Eve Eng')).toBeInTheDocument()
    expect(within(column).getByText('Needs reassignment')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Not started, 0 tasks' })).toBeInTheDocument()
  })

  it('only shows In Review where the organization uses review', async () => {
    const { unmount } = renderBoard([makeTask()])
    await screen.findByRole('region', { name: 'Not started, 1 tasks' })
    expect(screen.queryByRole('region', { name: /In review/ })).not.toBeInTheDocument()
    unmount()

    renderBoard([makeTask()], {}, { review_required: true })
    expect(await screen.findByRole('region', { name: 'In review, 0 tasks' })).toBeInTheDocument()
  })

  it('runs left to right, with Blocked and Cancelled hidden until asked for', async () => {
    const { api } = renderBoard([makeTask({ status: 'blocked' })], {}, { review_required: true })

    await screen.findByRole('region', { name: 'Not started, 0 tasks' })
    expect(
      screen.getAllByTestId(/^column-/).map((column) => column.getAttribute('aria-label')),
    ).toEqual([
      'Not started, 0 tasks',
      'In progress, 0 tasks',
      'In review, 0 tasks',
      'Completed, 0 tasks',
    ])
    expect(
      lastCall(api, 'GET', '/organizations/7/departments/3/board')?.query.getAll('collapsed'),
    ).toEqual(['blocked', 'cancelled'])
  })

  it('swaps the board for Blocked on request, with its count on the toggle', async () => {
    const { user, router } = renderBoard([makeTask({ status: 'blocked' })])
    const toggle = await screen.findByRole('button', { name: 'Show Blocked column, 1 tasks' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(await screen.findByRole('region', { name: 'Blocked, 1 tasks' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?show=blocked')
    await waitFor(() =>
      expect(screen.getAllByTestId(/^column-/).map((column) => column.dataset.testid)).toEqual([
        'column-blocked',
      ]),
    )

    await user.click(screen.getByRole('button', { name: 'Show Blocked column, 1 tasks' }))

    expect(await screen.findByRole('region', { name: 'Not started, 0 tasks' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /Blocked/ })).not.toBeInTheDocument(),
    )
  })

  it('shows Blocked and Cancelled together, and nothing else', async () => {
    const { user } = renderBoard([makeTask({ status: 'blocked' })])

    await user.click(await screen.findByRole('button', { name: /^Show Blocked column/ }))
    await user.click(await screen.findByRole('button', { name: /^Show Cancelled column/ }))

    await waitFor(() =>
      expect(screen.getAllByTestId(/^column-/).map((column) => column.dataset.testid)).toEqual([
        'column-blocked',
        'column-cancelled',
      ]),
    )
  })

  it('offers to show the column when a card moves to a hidden one', async () => {
    const task = makeTask({ allowed_statuses: ['blocked'] })
    const { user, router } = renderBoard([task], {
      'PATCH /tasks/1': detail({ ...task, status: 'blocked' }),
    })
    await user.click(
      await screen.findByRole('button', { name: 'Move “Fix the login page” to another column' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Blocked' }))

    await user.click(await screen.findByRole('button', { name: 'Show column' }))

    await waitFor(() => expect(router.state.location.search).toBe('?show=blocked'))
  })

  it('points to completed tasks too old for the board', async () => {
    const board = makeBoard([makeTask({ status: 'completed' })])
    const { user, router } = renderBoard([], {
      'GET /organizations/7/departments/3/board': {
        ...board,
        columns: board.columns.map((column) =>
          column.status === 'completed' ? { ...column, older: 12 } : column,
        ),
      },
    })
    const completed = await screen.findByRole('region', { name: 'Completed, 1 tasks' })
    expect(within(completed).getByText(/Last 30 days/)).toBeInTheDocument()

    await user.click(within(completed).getByRole('button', { name: '12 older in the List view' }))

    await waitFor(() => expect(router.state.location.search).toBe('?layout=list&status=completed'))
  })

  it('drops the List view’s status filter on the way back to the board', async () => {
    const { user, router } = renderBoardAt('/org/7/boards/3?layout=list&status=completed')

    await user.click(await screen.findByRole('button', { name: 'Board' }))

    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('moves a card from its menu', async () => {
    const task = makeTask()
    const { user, api } = renderBoard([task], {
      'PATCH /tasks/1': detail({ ...task, status: 'in_progress' }),
    })
    await user.click(
      await screen.findByRole('button', { name: 'Move “Fix the login page” to another column' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'In progress' }))

    await waitFor(() =>
      expect(lastCall(api, 'PATCH', '/tasks/1')?.body).toEqual({ status: 'in_progress' }),
    )
  })

  it('puts the card back and explains when the server refuses', async () => {
    const task = makeTask()
    const { user } = renderBoard([task], {
      'PATCH /tasks/1': () =>
        jsonResponse(
          {
            error: {
              code: 'open_subtasks',
              message: 'Finish or cancel 1 open subtask(s) before completing this task.',
              details: [],
              request_id: null,
            },
          },
          409,
        ),
    })
    await user.click(
      await screen.findByRole('button', { name: 'Move “Fix the login page” to another column' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Completed' }))

    expect(await screen.findByText(/Finish or cancel 1 open subtask/)).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Not started, 1 tasks' })).toBeInTheDocument()
  })

  it('offers no move controls on a task the viewer can only read', async () => {
    renderBoard([makeTask({ allowed_statuses: [], actions: [] })])
    await screen.findByRole('link', { name: 'Fix the login page' })
    expect(screen.queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Drag/ })).not.toBeInTheDocument()
  })

  it('treats a department the viewer can’t open as a page that doesn’t exist', async () => {
    mockApi(
      signedInRoutes({
        ...routes,
        'GET /organizations/7/departments/3/board': () =>
          jsonResponse(
            {
              error: {
                code: 'not_found',
                message: 'Department not found.',
                details: [],
                request_id: null,
              },
            },
            404,
          ),
      }),
    )
    renderApp('/org/7/boards/3')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('hides New task on an archived department', async () => {
    renderBoard([makeTask()], {}, { archived: true, can_create: false })
    expect(await screen.findByText(/This department is archived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument()
  })

  it('keeps filters in the URL and sends them to the board', async () => {
    const { user, api, router } = renderBoard([makeTask()])
    await user.click(await screen.findByRole('button', { name: 'More filters' }))
    await user.selectOptions(await screen.findByLabelText('Filter by assignee'), 'Eve Eng')

    await waitFor(() => expect(router.state.location.search).toContain('assignee=2'))
    await waitFor(() =>
      expect(
        lastCall(api, 'GET', '/organizations/7/departments/3/board')?.query.get('assignee'),
      ).toBe('2'),
    )
  })
})

describe('list and calendar', () => {
  it('sorts by deadline from the table header', async () => {
    const api = mockApi(
      signedInRoutes({
        ...routes,
        'GET /organizations/7/departments/3/board': makeBoard([]),
        'GET /organizations/7/tasks': emptyPage([makeTask()]),
      }),
    )
    const { user, router } = renderApp('/org/7/boards/3?layout=list')
    await user.click(await screen.findByRole('button', { name: 'Deadline' }))

    await waitFor(() => expect(router.state.location.search).toContain('sort=-due'))
    await waitFor(() =>
      expect(lastCall(api, 'GET', '/organizations/7/tasks')?.query.get('sort')).toBe('-due'),
    )
  })

  it('places tasks on their deadline in the organization’s time zone', async () => {
    // 20:00 UTC on 30 Nov is already 1 Dec in Kolkata.
    const task = makeTask({ title: 'Late night', due_at: '2026-11-30T20:00:00Z' })
    const api = mockApi(
      signedInRoutes({
        ...routes,
        'GET /organizations/7/departments/3/board': makeBoard([]),
        'GET /organizations/7/tasks': emptyPage([task]),
      }),
    )
    const { user } = renderApp('/org/7/boards/3?layout=calendar&month=2026-12')

    const day = await screen.findByTestId('day-2026-12-01')
    expect(await within(day).findByRole('link', { name: /Late night/ })).toBeInTheDocument()
    const call = lastCall(api, 'GET', '/organizations/7/tasks')
    expect(call?.query.get('due_from')).toBe('2026-11-30')
    expect(call?.query.get('department_id')).toBe('3')

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'January 2027' })).toBeInTheDocument()
  })
})

describe('creating a task', () => {
  const created = detail(makeTask({ id: 9, title: 'New work' }))

  it('sends the department, assignee and visibility', async () => {
    const { user, api } = renderBoard([], {
      'POST /organizations/7/tasks': created,
      'GET /tasks/9': created,
      'GET /tasks/9/activity': [],
    })
    await user.click(await screen.findByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })

    await user.type(within(dialog).getByLabelText('Title'), 'New work')
    await user.selectOptions(
      within(dialog).getByLabelText('Assignee'),
      await within(dialog).findByRole('option', { name: 'Eve Eng' }),
    )
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'high')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(lastCall(api, 'POST', '/organizations/7/tasks')?.body).toMatchObject({
        title: 'New work',
        department_id: 3,
        assigned_to: 2,
        priority: 'high',
        visibility: 'department',
      }),
    )
  })

  it('tells members that admins can open private tasks', async () => {
    const { user } = renderBoard([])
    await user.click(await screen.findByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })

    await user.selectOptions(within(dialog).getByLabelText('Who can see this'), 'private')

    expect(within(dialog).getByText(/Organization admins can still open it/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: 'Organization' })).not.toBeInTheDocument()
  })

  it('offers organization-wide sharing to administrators', async () => {
    const { user } = renderBoard([], { 'GET /me/organizations': [admin] })
    await user.click(await screen.findByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByRole('option', { name: 'Organization' })).toBeInTheDocument()
  })
})

describe('My Work and Team Tasks', () => {
  it('splits what’s assigned from what you’re helping with', async () => {
    const api = mockApi(signedInRoutes({ ...routes }))
    const { user } = renderApp('/org/7/my-work')
    expect(await screen.findByText('Nothing assigned to you')).toBeInTheDocument()
    expect(lastCall(api, 'GET', '/organizations/7/tasks')?.query.get('view')).toBe('my_work')

    await user.click(screen.getByRole('button', { name: 'Collaborating' }))
    await waitFor(() =>
      expect(lastCall(api, 'GET', '/organizations/7/tasks')?.query.get('view')).toBe(
        'collaborating',
      ),
    )
  })

  it('finds tasks that need reassigning', async () => {
    const api = mockApi(
      signedInRoutes({ ...routes, 'GET /organizations/7/tasks': emptyPage([makeTask()]) }),
    )
    const { user } = renderApp('/org/7/tasks')
    await screen.findByRole('link', { name: 'Fix the login page' })

    await user.click(screen.getByRole('button', { name: 'Needs reassignment' }))

    await waitFor(() =>
      expect(lastCall(api, 'GET', '/organizations/7/tasks')?.query.get('needs_reassignment')).toBe(
        'true',
      ),
    )
  })

  it('adds Work and Boards to the organization’s navigation', async () => {
    mockApi(signedInRoutes({ ...routes }))
    renderApp('/org/7/my-work')
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    expect(await within(nav).findByRole('link', { name: 'Team Tasks' })).toBeInTheDocument()
    expect(await within(nav).findByRole('link', { name: 'Workboard' })).toHaveAttribute(
      'href',
      '/org/7/boards/3',
    )
  })
})
