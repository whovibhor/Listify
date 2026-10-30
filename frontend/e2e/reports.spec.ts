import { readFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import {
  apiPost,
  createOrganization,
  departmentId,
  inviteToDepartment,
  newUser,
} from './helpers.js'

async function userId(page: Page) {
  return (await (await page.request.get('/api/v1/me')).json()).id as number
}

test('managers read reports, and the numbers only ever cover what they may see', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'repowner')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'repmate')
  const orgId = await createOrganization(
    owner,
    `Reports ${testInfo.project.name} ${Date.now()}`,
    false,
  )
  await inviteToDepartment(owner, teammate, orgId, 'Engineering')
  const engineering = await departmentId(owner, orgId, 'Engineering')
  const amy = await userId(teammate)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const shared = { department_id: engineering, visibility: 'department' }
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    ...shared,
    title: '=HYPERLINK("http://evil")',
    assigned_to: amy,
  })
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    ...shared,
    title: 'Overdue contract',
    assigned_to: amy,
    due_date: '2026-01-05',
  })
  const finished = await apiPost(owner, `/organizations/${orgId}/tasks`, {
    ...shared,
    title: 'Finished on time',
    due_date: tomorrow,
  })
  await apiPost(owner, `/tasks/${finished.id}/complete`, {})
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    department_id: engineering,
    visibility: 'private',
    title: 'Private restructuring',
  })

  // The Owner sees the whole organization, its timezone, and how each number is defined.
  await owner.goto(`/org/${orgId}/reports`)
  await expect(owner.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
  await expect(owner.getByText(/times in /)).toBeVisible()
  await expect(owner.getByRole('link', { name: /^Open\b.*\b3\b/ })).toBeVisible()
  await expect(owner.getByText('1 of 1 task with a deadline')).toBeVisible()

  // The chart really draws both lines across the period.
  const lines = owner.locator('path.recharts-line-curve')
  await expect(lines).toHaveCount(2)
  const drawn = await lines.first().boundingBox()
  expect(drawn?.width).toBeGreaterThan(150)
  await expect(owner.getByRole('radio', { name: '30 days' })).toBeChecked()

  // A real export: the file holds the rows, and a formula stays harmless text.
  const download = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^listify-tasks-.*\.csv$/)
  const csv = await readFile(await file.path(), 'utf8')
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
  expect(csv).toContain('Private restructuring')
  expect(csv.trim().split('\r\n')).toHaveLength(5)

  // The period carries from one report to the next.
  await owner.getByRole('radio', { name: '90 days' }).click()
  await expect(owner.getByRole('radio', { name: '90 days' })).toBeChecked()
  const departmentLink = owner
    .getByRole('table', { name: /each department/ })
    .getByRole('link', { name: 'Engineering' })
  await expect(departmentLink).toHaveAttribute('href', /range=90d/)
  await departmentLink.click()
  await expect(owner.getByRole('heading', { level: 1, name: 'Engineering' })).toBeVisible()
  await expect(owner.getByRole('radio', { name: '90 days' })).toBeChecked()
  await expect(owner.getByText('Overdue contract')).toBeVisible()
  await expect(owner.getByText('Finished on time')).toBeVisible()

  // Opening a person keeps the same dates, and shows work without any score.
  await owner
    .getByRole('table', { name: /each person/ })
    .getByRole('link', { name: 'Amy Applicant' })
    .click()
  await expect(owner.getByRole('heading', { level: 1, name: 'Amy Applicant' })).toBeVisible()
  await expect(owner.getByText('On-time rate')).toBeHidden()

  // A Department Manager's report counts what they can open, so the private task isn't in it.
  const members = await (
    await owner.request.get(`/api/v1/organizations/${orgId}/members`, { params: { q: 'Amy' } })
  ).json()
  const csrf = (await owner.context().cookies()).find((c) => c.name === 'listify_csrf')?.value ?? ''
  const promoted = await owner.request.patch(
    `/api/v1/organizations/${orgId}/members/${members.items[0].membership_id}/roles`,
    {
      data: {
        organization_role: 'member',
        department_roles: [{ department_id: engineering, role_key: 'department_manager' }],
      },
      headers: { 'X-CSRF-Token': csrf },
    },
  )
  expect(promoted.ok(), await promoted.text()).toBe(true)

  await teammate.goto(`/org/${orgId}/reports/departments/${engineering}`)
  await expect(teammate.getByRole('heading', { level: 1, name: 'Engineering' })).toBeVisible()
  await expect(teammate.getByText('tasks you can see')).toBeVisible()
  await expect(teammate.getByRole('link', { name: /^Open\b.*\b2\b/ })).toBeVisible()
  await expect(teammate.getByText('Private restructuring')).toBeHidden()
  const refused = await teammate.request.get(`/api/v1/organizations/${orgId}/dashboard`)
  expect(refused.status()).toBe(403)
})

test('a member gets their own summary, and nothing wider', async ({ browser }, testInfo) => {
  test.setTimeout(90_000)
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'repown2')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'repmem2')
  const orgId = await createOrganization(
    owner,
    `Summary ${testInfo.project.name} ${Date.now()}`,
    false,
  )
  await inviteToDepartment(owner, teammate, orgId, 'Engineering')
  const engineering = await departmentId(owner, orgId, 'Engineering')
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Write the handbook',
    department_id: engineering,
    assigned_to: await userId(teammate),
  })

  await teammate.goto(`/org/${orgId}`)
  await expect(teammate.getByRole('heading', { name: 'Your work' })).toBeVisible()
  await teammate.getByRole('link', { name: 'My summary' }).click()
  await expect(teammate.getByRole('heading', { level: 1, name: 'My summary' })).toBeVisible()
  await expect(teammate.getByRole('button', { name: 'Export CSV' })).toBeHidden()
  await expect(teammate.getByRole('link', { name: /^Assigned\b.*\b1\b/ })).toBeVisible()

  const blocked = await teammate.request.get(
    `/api/v1/organizations/${orgId}/departments/${engineering}/dashboard`,
  )
  expect(blocked.status()).toBe(403)
})

test('report screens have no detectable accessibility violations', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000)
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'repaxe')
  const orgId = await createOrganization(
    owner,
    `Report axe ${testInfo.project.name} ${Date.now()}`,
    false,
  )
  const engineering = await departmentId(owner, orgId, 'Engineering')
  const task = await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Audit the checkout',
    department_id: engineering,
    due_date: '2026-01-05',
  })
  await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Finished',
    department_id: engineering,
  }).then((done) => apiPost(owner, `/tasks/${done.id}/complete`, {}))
  expect(task.id).toBeGreaterThan(0)

  const scan = async (label: string) => {
    await owner.waitForLoadState('networkidle')
    await owner.waitForTimeout(600)
    const results = await new AxeBuilder({ page: owner })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${label}: ${results.violations.map((v) => `${v.id} ${v.nodes[0]?.html.slice(0, 140)}`).join(' | ')}`,
    ).toEqual([])
  }

  await owner.goto(`/org/${orgId}/reports`)
  await expect(owner.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
  await scan('organization report')
  await owner.getByRole('radio', { name: 'Custom' }).click()
  await scan('custom dates')
  await owner.goto(`/org/${orgId}/reports/departments/${engineering}`)
  await expect(owner.getByRole('heading', { level: 1, name: 'Engineering' })).toBeVisible()
  await scan('department report')
  await owner.goto(`/org/${orgId}/reports/members/${await userId(owner)}`)
  await expect(owner.getByRole('heading', { level: 1, name: 'My summary' })).toBeVisible()
  await scan('member summary')
})
