import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { addDays } from 'date-fns'

import { localDateKey, nowIn } from '@/features/tasks/dates'
import type { Task, TaskDetail } from '@/features/tasks/types'
import { jsonResponse, renderApp } from '@/test/render'
import { emptyPage, mockApi, noContent, signedInRoutes } from '@/test/mock-api'

afterEach(() => vi.unstubAllGlobals())

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    parent_task_id: null,
    title: 'Write report',
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
    ...overrides,
  }
}

const detail = (task: Task): TaskDetail => ({ ...task, subtasks: [] })

describe('My Tasks list', () => {
  it('shows tasks with priority, overdue state, subtask progress and tags', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/tasks': emptyPage([
          makeTask({
            title: 'Pay rent',
            priority: 'urgent',
            due_at: '2026-10-01T18:29:59Z',
            is_overdue: true,
            subtask_count: 3,
            subtasks_completed: 1,
            tags: [{ id: 7, name: 'home', color: 'green' }],
          }),
        ]),
      }),
    )
    renderApp('/personal/tasks')

    const row = (await screen.findByText('Pay rent')).closest('li')!
    expect(within(row).getByText('Urgent')).toBeInTheDocument()
    // Visible "· Overdue" plus a screen-reader prefix: the state is never color-only.
    expect(within(row).getByText('Overdue:')).toHaveClass('sr-only')
    expect(within(row).getByText('· Overdue')).toBeInTheDocument()
    expect(within(row).getByText('1/3')).toBeInTheDocument()
    expect(within(row).getByText('home')).toBeInTheDocument()
  })

  it('shows a helpful empty state', async () => {
    mockApi(signedInRoutes())
    renderApp('/personal/tasks')
    expect(await screen.findByText('No open tasks')).toBeInTheDocument()
  })

  it('sends filters to the API and keeps them in the URL', async () => {
    const { calls } = mockApi(signedInRoutes())
    const { user, router } = renderApp('/personal/tasks')

    await user.click(await screen.findByRole('button', { name: /priority/i }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Urgent' }))

    await waitFor(() => expect(router.state.location.search).toContain('priority=urgent'))
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/me/tasks' && c.query?.getAll('priority').includes('urgent')),
      ).toBe(true),
    )
  })
})

describe('creating and completing', () => {
  it('quick-adds a task due today from My Day', async () => {
    const { calls } = mockApi(
      signedInRoutes({
        'POST /me/tasks': () => jsonResponse(detail(makeTask({ title: 'Call mum' })), 201),
      }),
    )
    const { user } = renderApp('/personal/my-day')

    const input = await screen.findByLabelText('New task title')
    await user.type(input, 'Call mum{Enter}')

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/me/tasks')).toBe(true),
    )
    const body = calls.find((c) => c.method === 'POST' && c.path === '/me/tasks')!.body as Record<
      string,
      string
    >
    expect(body.title).toBe('Call mum')
    expect(body.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('ticks a task optimistically and rolls back when the server refuses', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/tasks': emptyPage([makeTask({ title: 'Plan trip', subtask_count: 1 })]),
        'POST /tasks/1/complete': () =>
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
      }),
    )
    const { user } = renderApp('/personal/tasks')

    const checkbox = await screen.findByRole('checkbox', { name: /complete “plan trip”/i })
    await user.click(checkbox)

    expect(await screen.findByText(/open subtask/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /plan trip/i })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    )
  })
})

describe('task detail panel', () => {
  it('opens from the list, saves an edited title and deletes after confirmation', async () => {
    const task = makeTask({ title: 'Draft' })
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/tasks': emptyPage([task]),
        'GET /tasks/1': detail(task),
        'GET /tasks/1/activity': [
          {
            id: 1,
            event_type: 'created',
            actor_id: 1,
            actor_name: 'Ada Lovelace',
            old_value: null,
            new_value: { title: 'Draft' },
            created_at: '2026-10-29T09:00:00Z',
          },
        ],
        'PATCH /tasks/1': detail({ ...task, title: 'Final draft' }),
        'DELETE /tasks/1': noContent,
      }),
    )
    const { user, router } = renderApp('/personal/tasks')

    await user.click(await screen.findByRole('button', { name: 'Draft' }))
    const dialog = await screen.findByRole('dialog')
    expect(router.state.location.search).toContain('task=1')
    expect(await within(dialog).findByText('created this task')).toBeInTheDocument()

    const title = within(dialog).getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Final draft{Enter}')
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: 'Final draft' }),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete permanently' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/tasks/1')).toBe(true),
    )
    await waitFor(() => expect(router.state.location.search).not.toContain('task='))
  })
})

describe('Upcoming', () => {
  it('shows a 14-day strip and an agenda; picking a day targets quick add at it', async () => {
    const inTwoDays = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/tasks': emptyPage([makeTask({ id: 1, title: 'Dentist', due_at: inTwoDays })]),
        'POST /me/tasks': () => jsonResponse(detail(makeTask({ id: 2, title: 'Pack bags' })), 201),
      }),
    )
    const { user } = renderApp('/personal/upcoming')

    const dentist = await screen.findByText('Dentist')
    expect(dentist.closest('li[id^="day-"]')).not.toBeNull()
    const strip = screen.getByRole('listbox', { name: 'Choose a day' })
    const days = within(strip).getAllByRole('option')
    expect(days).toHaveLength(14)
    // The first day with work is preselected.
    expect(days.find((d) => d.getAttribute('aria-selected') === 'true')).toHaveAccessibleName(
      /1 task due/,
    )

    await user.click(days[0]) // tomorrow
    const input = screen.getByLabelText('New task title')
    expect(input).toHaveAttribute('placeholder', 'Add a task for tomorrow…')
    await user.type(input, 'Pack bags{Enter}')
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, string>
    // Tomorrow in the user's profile timezone (Asia/Kolkata), not the test machine's.
    expect(body.due_date).toBe(localDateKey(addDays(nowIn('Asia/Kolkata'), 1)))
  })
})

describe('My Day', () => {
  it("shows today's progress, sections and what's already done", async () => {
    mockApi(
      signedInRoutes({
        'GET /me/tasks': (_init: RequestInit, url: URL) =>
          url.searchParams.get('view') === 'done_today'
            ? jsonResponse(
                emptyPage([makeTask({ id: 9, title: 'Morning run', status: 'completed' })]),
              )
            : jsonResponse(
                emptyPage([
                  makeTask({
                    id: 1,
                    title: 'Late invoice',
                    due_at: '2026-10-01T18:29:59Z',
                    is_overdue: true,
                  }),
                  makeTask({
                    id: 2,
                    title: 'Write blog',
                    due_at: new Date(Date.now() + 60_000).toISOString(),
                  }),
                ]),
              ),
      }),
    )
    renderApp('/personal/my-day')

    const ring = await screen.findByRole('progressbar', { name: "Today's progress" })
    // Both queries (remaining + done today) feed the ring.
    await waitFor(() => expect(ring).toHaveAttribute('aria-valuetext', '1 of 3 done'))
    expect(screen.getByRole('button', { name: /overdue/i, expanded: true })).toBeInTheDocument()
    expect(screen.getByText('Late invoice')).toBeInTheDocument()
    const doneToggle = screen.getByRole('button', { name: /done today/i })
    expect(doneToggle).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('My Tasks planner', () => {
  it('groups open tasks by when they are due', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/tasks': emptyPage([
          makeTask({
            id: 1,
            title: 'Late invoice',
            due_at: '2026-10-01T18:29:59Z',
            is_overdue: true,
          }),
          makeTask({ id: 2, title: 'Someday idea' }),
        ]),
      }),
    )
    renderApp('/personal/tasks')

    const overdue = await screen.findByRole('button', { name: /^overdue/i, expanded: true })
    expect(overdue.closest('section')).toHaveTextContent('Late invoice')
    const noDeadline = screen.getByRole('button', { name: /no deadline/i })
    expect(noDeadline.closest('section')).toHaveTextContent('Someday idea')
  })
})
