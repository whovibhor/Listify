import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import {
  apiPost,
  createOrganization,
  departmentId,
  inviteToDepartment,
  newUser,
} from './helpers.js'

function section(page: Page, name: string) {
  return page
    .getByRole('navigation', { name: 'Task sections' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click()
}

test('a team talks about a task, shares a file and asks for an update', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'colowner')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'colmate')
  const orgName = `Collab ${testInfo.project.name} ${Date.now()}`
  const orgId = await createOrganization(owner, orgName, false)
  await inviteToDepartment(owner, teammate, orgId, 'Engineering')
  const engineering = await departmentId(owner, orgId, 'Engineering')
  const amy = (await (await teammate.request.get('/api/v1/me')).json()).id as number

  const task = await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Launch checklist',
    department_id: engineering,
    assigned_to: amy,
  })
  const taskPage = `/org/${orgId}/tasks/${task.id}`

  // The assignment reaches Amy's inbox, with a count on the bell.
  await teammate.goto(`/org/${orgId}/inbox`)
  await expect(teammate.getByRole('link', { name: /Notifications, \d+ unread/ })).toBeVisible()
  await teammate.getByRole('button', { name: /assigned you a task/ }).click()
  const amyPage = teammate.getByRole('main')
  await expect(amyPage.getByRole('heading', { level: 1, name: 'Launch checklist' })).toBeVisible()

  // Amy attaches a file and comments; a disguised file is refused.
  await section(teammate, 'Files')
  await amyPage.getByLabel('Choose files to attach').setInputFiles({
    name: 'evil.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<script>alert(1)</script>'),
  })
  await expect(teammate.getByText("This file's contents don't match its type.")).toBeVisible()
  await amyPage.getByLabel('Choose files to attach').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Launch notes'),
  })
  await expect(amyPage.getByRole('link', { name: 'Download notes.txt' })).toBeVisible()
  await section(teammate, 'Comments')
  await amyPage.getByLabel('Add a comment').fill('<b>Started</b> on this')
  await amyPage.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(amyPage.getByText('<b>Started</b> on this')).toBeVisible()

  // Olivia is told, downloads the real file, and asks for an update.
  await owner.goto(`/org/${orgId}/inbox`)
  await owner.getByRole('button', { name: /Amy Applicant commented/ }).click()
  const ownerPage = owner.getByRole('main')
  await expect(ownerPage.getByText('<b>Started</b> on this')).toBeVisible()
  await section(owner, 'Files')
  const download = owner.waitForEvent('download')
  await ownerPage.getByRole('link', { name: 'Download notes.txt' }).click()
  expect((await download).suggestedFilename()).toBe('notes.txt')

  await section(owner, 'Update requests')
  await ownerPage.getByRole('button', { name: 'Request an update' }).click()
  const ask = owner.getByRole('dialog', { name: 'Request an update' })
  await ask.getByLabel('What would you like to know?').fill('Ready for Friday?')
  await ask.getByRole('button', { name: 'Send request' }).click()
  await expect(ownerPage.getByText('Ready for Friday?')).toBeVisible()

  // Amy answers from the Inbox and changes the status at the same time.
  await teammate.goto(`/org/${orgId}/inbox`)
  await teammate.getByRole('button', { name: 'Respond about Launch checklist' }).click()
  const respond = teammate.getByRole('dialog', { name: 'Respond to Olivia Owner' })
  await respond.getByLabel('Your update').fill('Yes, on track')
  await respond.getByLabel('Change status (optional)').selectOption('in_progress')
  await respond.getByRole('button', { name: 'Send response' }).click()
  await expect(teammate.getByText('Waiting for your update')).toBeHidden()

  await owner.goto(`${taskPage}/requests`)
  await expect(ownerPage.getByText('Yes, on track')).toBeVisible()

  // Losing access removes everything: the old notification says nothing about the task.
  const members = await (
    await owner.request.get(`/api/v1/organizations/${orgId}/members`, { params: { q: 'Amy' } })
  ).json()
  await apiPost(
    owner,
    `/organizations/${orgId}/members/${members.items[0].membership_id}/remove`,
    {},
  )
  await teammate.goto('/inbox')
  await expect(teammate.getByText('You were removed from', { exact: false })).toBeVisible()
  await expect(teammate.getByText('You no longer have access to this item').first()).toBeVisible()
  await expect(teammate.getByText('Launch checklist')).toBeHidden()
  const attachments = await (await owner.request.get(`/api/v1/tasks/${task.id}/attachments`)).json()
  const blocked = await teammate.request.get(`/api/v1/attachments/${attachments[0].id}/download`)
  expect(blocked.status()).toBe(404)
})

test('collaboration screens have no detectable accessibility violations', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000)
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'colaxe')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'colaxe2')
  const orgId = await createOrganization(owner, `Axe ${testInfo.project.name} ${Date.now()}`, false)
  await inviteToDepartment(owner, teammate, orgId, 'Engineering')
  const engineering = await departmentId(owner, orgId, 'Engineering')
  const amy = (await (await teammate.request.get('/api/v1/me')).json()).id as number
  const task = await apiPost(owner, `/organizations/${orgId}/tasks`, {
    title: 'Audit the checkout',
    department_id: engineering,
    assigned_to: amy,
  })
  await apiPost(owner, `/tasks/${task.id}/comments`, { body: 'Please take a look' })
  await apiPost(owner, `/tasks/${task.id}/update-requests`, {
    recipient_id: amy,
    message: 'Any news?',
  })

  const scan = async (label: string) => {
    await teammate.waitForLoadState('networkidle')
    await teammate.waitForTimeout(400)
    const results = await new AxeBuilder({ page: teammate })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${label}: ${results.violations.map((v) => `${v.id} ${v.nodes[0]?.html.slice(0, 140)}`).join(' | ')}`,
    ).toEqual([])
  }

  await teammate.goto(`/org/${orgId}/inbox`)
  await expect(teammate.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  await scan('inbox')
  await teammate.goto(`/org/${orgId}/tasks/${task.id}`)
  await expect(teammate.getByRole('main').getByText('Please take a look')).toBeVisible()
  await scan('task page')
  await section(teammate, 'Comments')
  await expect(teammate.getByLabel('Add a comment')).toBeVisible()
  await scan('task comments')
  await section(teammate, 'Update requests')
  await teammate.getByRole('main').getByRole('button', { name: 'Respond' }).click()
  await expect(teammate.getByRole('dialog', { name: /Respond to/ })).toBeVisible()
  await scan('respond dialog')
})
