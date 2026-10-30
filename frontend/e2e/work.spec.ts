import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import {
  apiPost,
  createOrganization,
  departmentId,
  inviteToDepartment,
  newUser,
} from './helpers.js'

function localDate(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toLocaleDateString('en-CA')
}

/** A real mouse drag, in steps, so the drag library sees the same events a person makes. */
async function drag(page: Page, from: string, toColumn: string) {
  const card = page.getByRole('button', { name: from, exact: true })
  await card.scrollIntoViewIfNeeded()
  const start = await card.boundingBox()
  const target = await page.getByTestId(`column-${toColumn}`).boundingBox()
  await page.mouse.move(start!.x + 40, start!.y + start!.height / 2)
  await page.mouse.down()
  await page.mouse.move(start!.x + 60, start!.y + 30, { steps: 5 })
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 80, { steps: 15 })
  await page.mouse.up()
}

test('a team plans work on a board, and access follows the rules', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const orgName = `Work ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'workowner')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'workmate')
  const orgId = await createOrganization(owner, orgName, false)
  await inviteToDepartment(owner, teammate, orgId, 'Engineering')
  const engineering = await departmentId(owner, orgId, 'Engineering')
  const boardUrl = `/org/${orgId}/departments/${engineering}`

  // Owner creates a task for Amy, from the board.
  await owner.goto(boardUrl)
  await expect(owner.getByRole('heading', { level: 1, name: 'Engineering' })).toBeVisible()
  await owner.getByRole('button', { name: 'New task' }).click()
  const dialog = owner.getByRole('dialog', { name: 'New task' })
  await dialog.getByLabel('Title').fill('Fix the login page')
  await dialog.getByLabel('Assignee').selectOption({ label: 'Amy Applicant' })
  await dialog.getByLabel('Priority').selectOption('high')
  await dialog.getByLabel('Deadline (optional)').fill(localDate(1))
  await dialog.getByRole('button', { name: 'Create task' }).click()
  await expect(dialog).toBeHidden()

  // It opens in the panel, with the people on it labelled.
  const panel = owner.getByRole('dialog')
  await expect(panel.getByLabel('Assignee')).toHaveValue(/\d+/)
  await expect(panel.getByText('Created by')).toBeVisible()
  await owner.keyboard.press('Escape')

  // A private task stays with its creator.
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Salary review',
    department_id: engineering,
    visibility: 'private',
  })

  // Amy sees her work, and what's shared with the department, but not the private task.
  await teammate.goto(`/org/${orgId}/my-work`)
  await expect(teammate.getByRole('button', { name: /Fix the login page/ })).toBeVisible()
  await teammate.goto(boardUrl)
  await expect(
    teammate.getByRole('button', { name: 'Fix the login page', exact: true }),
  ).toBeVisible()
  await expect(teammate.getByText('Salary review')).toBeHidden()
  await teammate.goto(`/org/${orgId}/tasks`)
  await teammate.getByLabel('Search tasks by title').fill('Salary')
  await expect(teammate.getByText('Nothing matches')).toBeVisible()

  // She can't reach another department's board.
  const sales = await departmentId(owner, orgId, 'Sales')
  await teammate.goto(`/org/${orgId}/departments/${sales}`)
  await expect(teammate.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  // Dragging works on desktop. Phones use the same menu a keyboard user would.
  await teammate.goto(boardUrl)
  if (testInfo.project.name === 'desktop') {
    await drag(teammate, 'Fix the login page', 'in_progress')
  } else {
    await teammate
      .getByRole('button', { name: 'Move “Fix the login page” to another column' })
      .click()
    await teammate.getByRole('menuitem', { name: 'In progress' }).click()
  }
  const inProgress = teammate.getByTestId('column-in_progress')
  await expect(inProgress.getByText('Fix the login page')).toBeVisible()

  // It's saved, not just moved on screen, and the owner sees it too.
  await owner.goto(boardUrl)
  await expect(
    owner.getByTestId('column-in_progress').getByText('Fix the login page'),
  ).toBeVisible()

  // The list and the calendar show the same task.
  await owner.getByRole('button', { name: 'List' }).click()
  const table = owner.getByRole('table')
  await expect(table.getByRole('button', { name: 'Fix the login page' })).toBeVisible()
  await expect(table.getByRole('button', { name: 'Salary review' })).toBeVisible()
  await owner.getByRole('button', { name: 'Calendar' }).click()
  await expect(owner.getByRole('button', { name: /Fix the login page/ }).first()).toBeAttached()

  // Suspending Amy flags her task, and nothing is lost.
  await owner.goto(`/org/${orgId}/members`)
  await owner.getByRole('button', { name: 'Manage Amy Applicant' }).click()
  await owner.getByRole('button', { name: 'Suspend' }).click()
  const suspendDialog = owner.getByRole('dialog', { name: 'Suspend Amy Applicant?' })
  await expect(suspendDialog.getByText('1 flagged for reassignment')).toBeVisible()
  await suspendDialog.getByRole('button', { name: 'Suspend member' }).click()
  await expect(owner.getByText('Amy Applicant is suspended')).toBeVisible()

  await owner.goto(`/org/${orgId}/tasks`)
  await owner.getByRole('button', { name: 'Needs reassignment' }).click()
  await owner.getByRole('table').getByRole('button', { name: 'Fix the login page' }).click()
  const flagged = owner.getByRole('dialog')
  await expect(flagged.getByText('Amy Applicant can no longer work on this task.')).toBeVisible()
  await flagged.getByLabel('Assignee').selectOption('')
  await expect(flagged.getByText(/can no longer work/)).toBeHidden()

  // History is complete.
  await expect(flagged.getByText(/assigned this to Amy Applicant/)).toBeVisible()
  await expect(flagged.getByText(/unassigned this task/)).toBeVisible()
})

test('work pages have no detectable accessibility violations', async ({ browser }, testInfo) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'workaxe')
  const orgId = await createOrganization(owner, `Axe ${testInfo.project.name} ${Date.now()}`, false)
  const engineering = await departmentId(owner, orgId, 'Engineering')
  await apiPost(owner, `/organizations/${orgId}/tags`, { name: 'release', color: 'violet' })
  const task = await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Audit the checkout flow',
    department_id: engineering,
    priority: 'urgent',
    due_date: localDate(2),
  })
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Overdue handover',
    department_id: engineering,
    due_date: localDate(-3),
  })

  const scan = async (label: string) => {
    await owner.waitForLoadState('networkidle')
    await owner.waitForTimeout(300)
    const results = await new AxeBuilder({ page: owner })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${label}: ${results.violations.map((v) => `${v.id} ${v.nodes[0]?.html.slice(0, 140)}`).join(' | ')}`,
    ).toEqual([])
  }

  const board = `/org/${orgId}/departments/${engineering}`
  for (const path of [
    board,
    `${board}?layout=list`,
    `${board}?layout=calendar`,
    `/org/${orgId}/my-work`,
    `/org/${orgId}/tasks`,
  ]) {
    await owner.goto(path)
    await expect(owner.locator('h1').first()).toBeVisible()
    await scan(path)
  }

  await owner.goto(board)
  await owner.getByRole('button', { name: 'New task' }).click()
  await expect(owner.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await scan('create dialog')

  await owner.goto(`${board}?task=${task.id}`)
  await expect(owner.getByRole('dialog').getByText('Created by')).toBeVisible()
  await scan('task panel')
  await owner.emulateMedia({ colorScheme: 'dark' })
  await scan('task panel in dark mode')
})
