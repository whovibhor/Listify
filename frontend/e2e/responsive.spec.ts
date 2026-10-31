import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

const LONG_MEMBER_NAME = 'Maximiliana Featherstonehaugh-Montgomery'
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const

const PAGES = [
  { path: '/', heading: /^Hi, /, name: 'home' },
  { path: '/personal/my-day', heading: 'My Day', name: 'my-day' },
  { path: '/personal/tasks', heading: 'My Tasks', name: 'my-tasks' },
  { path: '/personal/upcoming', heading: 'Upcoming', name: 'upcoming' },
  { path: '/personal/completed', heading: 'Completed', name: 'completed' },
  { path: '/personal/analytics', heading: 'Personal analytics', name: 'analytics' },
] as const

function localDate(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toLocaleDateString('en-CA') // YYYY-MM-DD in the browser's (= user's) timezone
}

/** Creates realistic data through the real API (same session cookie + CSRF as the SPA). */
async function seedData(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'denote_csrf')?.value ?? ''
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { 'X-CSRF-Token': csrf },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const work = await post('/me/tags', { name: 'work', color: 'violet' })
  const home = await post('/me/tags', { name: 'home', color: 'green' })
  await post('/me/tasks', {
    title: 'Renew passport application',
    due_date: localDate(-2),
    priority: 'urgent',
  })
  await post('/me/tasks', {
    title: 'Prepare the quarterly planning deck for the leadership offsite',
    due_date: localDate(0),
    due_time: '16:30',
    priority: 'high',
    tag_ids: [work.id],
  })
  const groceries = await post('/me/tasks', {
    title: 'Groceries',
    due_date: localDate(0),
    tag_ids: [home.id],
  })
  await post('/me/tasks', { title: 'Milk', parent_task_id: groceries.id })
  await post('/me/tasks', {
    title: 'Call the plumber',
    due_date: localDate(1),
    status: 'in_progress',
  })
  await post('/me/tasks', { title: 'Team retro notes', due_date: localDate(3), tag_ids: [work.id] })
  await post('/me/tasks', { title: 'Book dentist', due_date: localDate(9), priority: 'low' })
  await post('/me/tasks', { title: 'Read “Deep Work”' })
  const done = await post('/me/tasks', { title: 'Morning run', due_date: localDate(0) })
  await post(`/tasks/${done.id}/complete`, {})
  const organization = await post('/organizations', {
    name: 'Northwind Trading Company International',
    description: 'Long-established importer of speciality foods and household goods.',
    is_discoverable: true,
    departments: [
      { name: 'Engineering' },
      { name: 'Customer Success and Support' },
      { name: 'Sales' },
    ],
  })
  await post(`/organizations/${organization.id}/invitations`, {
    email: 'a.very.long.email.address.for.testing@example-company.com',
  })
  const departments = await (
    await page.request.get(`/api/v1/organizations/${organization.id}/departments`)
  ).json()
  const engineering = departments[0].id as number
  const release = await post(`/organizations/${organization.id}/tags`, {
    name: 'release',
    color: 'violet',
  })
  const teamTask = (title: string, fields: object = {}) =>
    post(`/organizations/${organization.id}/tasks`, {
      title,
      department_id: engineering,
      ...fields,
    })
  await teamTask('Plan the migration of the customer records to the new warehouse system', {
    priority: 'urgent',
    due_date: localDate(-1),
    tag_ids: [release.id],
  })
  const started = await teamTask('Review supplier contracts', { due_date: localDate(0) })
  await post(`/tasks/${started.id}/complete`, {})
  await teamTask('Update the onboarding guide', { priority: 'low', due_date: localDate(4) })
  return organization.id as number
}

/** A second person, in every department, so the member sheet has real content to lay out. */
async function addTeammate(browser: Browser, owner: Page, orgId: number) {
  const csrf = (await owner.context().cookies()).find((c) => c.name === 'denote_csrf')?.value ?? ''
  const headers = { 'X-CSRF-Token': csrf }
  const invitation = await owner.request.post(`/api/v1/organizations/${orgId}/invitations`, {
    data: { role_key: 'department_manager', department_id: await firstDepartment(owner, orgId) },
    headers,
  })
  expect(invitation.ok(), await invitation.text()).toBe(true)
  const { link } = await invitation.json()

  const context = await browser.newContext({ baseURL: new URL(owner.url()).origin })
  const teammate = await context.newPage()
  await teammate.goto('/register')
  await teammate.getByLabel('Full name').fill(LONG_MEMBER_NAME)
  await teammate.getByLabel('Email').fill(`long.name.${Date.now()}@example-company.com`)
  await teammate.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await teammate.getByRole('checkbox').check()
  await teammate.getByRole('button', { name: 'Create account' }).click()
  await expect(teammate.getByRole('heading', { name: /^Welcome, / })).toBeVisible()
  await teammate.goto(new URL(link).pathname)
  await teammate.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(teammate.getByRole('heading', { level: 1, name: /Northwind/ })).toBeVisible()
  await context.close()
}

async function firstDepartment(owner: Page, orgId: number) {
  const departments = await owner.request.get(`/api/v1/organizations/${orgId}/departments`)
  return (await departments.json())[0].id as number
}

async function expectNoSideScroll(element: Locator, label: string) {
  const overflow = await element.evaluate((node) => node.scrollWidth - node.clientWidth)
  expect(overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(0)
}

async function choosePersonal(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'denote_csrf')?.value ?? ''
  const response = await page.request.patch('/api/v1/me/preferences', {
    data: { last_organization_id: null },
    headers: { 'X-CSRF-Token': csrf },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

test('every page fits phone, tablet and desktop widths', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'viewports are set explicitly in this test')
  test.setTimeout(240_000)

  await page.goto('/register')
  await page.getByLabel('Full name').fill('Mary Jackson')
  await page.getByLabel('Email').fill(`responsive.${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Mary!' })).toBeVisible()
  const orgId = await seedData(page)
  await addTeammate(browser, page, orgId)
  const [firstDepartment] = await (
    await page.request.get(`/api/v1/organizations/${orgId}/departments`)
  ).json()
  const board = `/org/${orgId}/boards/${firstDepartment.id}`
  const me = await (await page.request.get('/api/v1/me')).json()
  const departmentName: string = firstDepartment.name
  const pages = [
    ...PAGES,
    { path: '/organizations/new', heading: 'Create an organization', name: 'org-new' },
    { path: '/organizations/join', heading: 'Join an organization', name: 'org-join' },
    { path: `/org/${orgId}`, heading: /Northwind/, name: 'org-overview' },
    { path: `/org/${orgId}/departments`, heading: 'Departments', name: 'org-departments' },
    {
      path: `/org/${orgId}/departments/${firstDepartment.id}`,
      heading: departmentName,
      name: 'org-department',
    },
    { path: `/org/${orgId}/members`, heading: 'Members', name: 'org-members' },
    { path: '/inbox', heading: 'Inbox', name: 'inbox' },
    { path: `/org/${orgId}/inbox`, heading: 'Inbox', name: 'org-inbox' },
    { path: `/org/${orgId}/my-work`, heading: 'My Work', name: 'org-my-work' },
    { path: `/org/${orgId}/tasks`, heading: 'Team Tasks', name: 'org-team-tasks' },
    { path: board, heading: departmentName, name: 'org-board' },
    { path: `${board}?layout=list`, heading: departmentName, name: 'org-board-list' },
    { path: `${board}?layout=calendar`, heading: departmentName, name: 'org-board-calendar' },
    { path: `/org/${orgId}/reports`, heading: 'Reports', name: 'org-reports' },
    {
      path: `/org/${orgId}/reports/departments/${firstDepartment.id}`,
      heading: departmentName,
      name: 'org-report-department',
    },
    {
      path: `/org/${orgId}/reports/members/${me.id}`,
      heading: 'My summary',
      name: 'org-report-member',
    },
    { path: `/org/${orgId}/requests`, heading: 'Join requests', name: 'org-requests' },
    { path: `/org/${orgId}/invitations`, heading: 'Invitations', name: 'org-invitations' },
    { path: `/org/${orgId}/activity`, heading: 'Activity log', name: 'org-activity' },
    { path: `/org/${orgId}/settings`, heading: 'Settings', name: 'org-settings' },
  ]

  // The chart's dark colors are their own, so they get looked at too.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`/org/${orgId}/reports`)
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/screens/responsive-dark-org-reports.png' })
  await page.emulateMedia({ colorScheme: 'light' })

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const target of pages) {
      // A fresh visit to `/` reopens the last workspace, so choose Personal first.
      if (target.path === '/') await choosePersonal(page)
      await page.goto(target.path)
      await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400) // let entrance animations settle before measuring
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(
        overflow,
        `${target.path} overflows horizontally at ${viewport.width}px`,
      ).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: `test-results/screens/responsive-${viewport.name}-${target.name}.png`,
        fullPage: true,
      })
    }
    // The task panel at this width.
    await page.goto('/personal/my-day')
    await page.getByRole('button', { name: /quarterly planning deck/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `test-results/screens/responsive-${viewport.name}-panel.png` })

    // The member sheet and its impact preview at this width.
    await page.goto(`/org/${orgId}/members`)
    await page.getByRole('button', { name: `Manage ${LONG_MEMBER_NAME}` }).click()
    const sheet = page.getByRole('dialog', { name: LONG_MEMBER_NAME })
    await expect(sheet).toBeVisible()
    await page.waitForTimeout(400)
    await expectNoSideScroll(sheet, `member sheet at ${viewport.width}px`)
    await page.screenshot({
      path: `test-results/screens/responsive-${viewport.name}-member-sheet.png`,
    })
    await sheet.getByRole('button', { name: 'Remove from organization' }).click()
    const dialog = page.getByRole('dialog', { name: /^Remove / })
    await expect(dialog.getByText('Personal tasks')).toBeVisible()
    await page.waitForTimeout(400)
    await expectNoSideScroll(dialog, `impact preview at ${viewport.width}px`)
    await page.screenshot({
      path: `test-results/screens/responsive-${viewport.name}-member-impact.png`,
    })
  }
})
