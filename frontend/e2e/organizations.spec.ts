import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { createOrganization, newUser, PASSWORD } from './helpers.js'

test('request to join, approval, and what each person can then do', async ({
  browser,
}, testInfo) => {
  const orgName = `Acme ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner')
  const applicant = await newUser(browser, testInfo, 'Amy Applicant', 'applicant')

  const orgId = await createOrganization(owner, orgName, true)

  // Applicant finds it and asks to join Sales.
  await applicant.goto('/organizations/join')
  await applicant.getByLabel('Search organizations by name').fill(orgName)
  await applicant.getByRole('button', { name: `Request to join ${orgName}` }).click()
  const dialog = applicant.getByRole('dialog')
  await dialog.getByLabel('Department').selectOption({ label: 'Sales' })
  await dialog.getByLabel('Note to the administrator (optional)').fill('New sales hire')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(applicant.getByText('Waiting for approval')).toBeVisible()

  // Pending means no access at all.
  await applicant.goto(`/org/${orgId}`)
  await expect(applicant.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  // Owner sees it, with a count, and approves.
  await owner.goto(`/org/${orgId}/requests`)
  await expect(owner.getByText('New sales hire')).toBeVisible()
  await owner.getByRole('button', { name: 'Approve Amy Applicant' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText('No pending requests')).toBeVisible()

  // Member now has the organization, without administration.
  await applicant.goto(`/org/${orgId}`)
  await expect(applicant.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  await applicant.goto(`/org/${orgId}/settings`)
  await expect(applicant.getByText("You don't have access to this page")).toBeVisible()
  await applicant.goto(`/org/${orgId}/departments`)
  await expect(applicant.getByRole('heading', { name: 'Sales', level: 2 })).toBeVisible()
  await expect(applicant.getByRole('heading', { name: 'Engineering', level: 2 })).toBeHidden()

  // Owner sees the new member and the audit trail.
  await owner.goto(`/org/${orgId}/members`)
  await expect(owner.getByText('Amy Applicant')).toBeVisible()
  await owner.goto(`/org/${orgId}/activity`)
  await expect(owner.getByText('approved Amy Applicant')).toBeVisible()
})

test('join a private organization with an invitation link', async ({ browser }, testInfo) => {
  const orgName = `Private ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner2')
  const invited = await newUser(browser, testInfo, 'Ian Invited', 'invited')
  const orgId = await createOrganization(owner, orgName, false)

  // Private: search finds nothing.
  await invited.goto('/organizations/join')
  await invited.getByLabel('Search organizations by name').fill(orgName)
  await expect(invited.getByText(/No organizations match/)).toBeVisible()

  await owner.goto(`/org/${orgId}/invitations`)
  await owner.getByRole('button', { name: 'Create link' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()

  await invited.goto(new URL(link).pathname)
  await expect(invited.getByRole('heading', { name: orgName })).toBeVisible()
  await invited.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(invited.getByRole('heading', { level: 1, name: orgName })).toBeVisible()

  // The link only works once.
  await invited.goto(new URL(link).pathname)
  await expect(invited.getByText("This invitation can't be used")).toBeVisible()
})

test('roles, departments, suspension, ownership and removal', async ({ browser }, testInfo) => {
  test.setTimeout(120_000)
  const orgName = `Managed ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner4')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'teammate')
  const orgId = await createOrganization(owner, orgName, true)

  await teammate.goto('/organizations/join')
  await teammate.getByLabel('Search organizations by name').fill(orgName)
  await teammate.getByRole('button', { name: `Request to join ${orgName}` }).click()
  const joinDialog = teammate.getByRole('dialog')
  await joinDialog.getByLabel('Department').selectOption({ label: 'Sales' })
  await joinDialog.getByRole('button', { name: 'Send request' }).click()
  await expect(teammate.getByText('Waiting for approval')).toBeVisible()
  await owner.goto(`/org/${orgId}/requests`)
  await owner.getByRole('button', { name: 'Approve Amy Applicant' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText('No pending requests')).toBeVisible()

  const manage = async () => {
    await owner.getByRole('button', { name: 'Manage Amy Applicant' }).click()
    return owner.getByRole('dialog', { name: 'Amy Applicant' })
  }

  // A department role, and the second department it needs.
  await owner.goto(`/org/${orgId}/members`)
  const sheet = await manage()
  await sheet.getByRole('combobox', { name: 'Add to a department' }).selectOption('Engineering')
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(sheet.getByText('Engineering')).toBeVisible()

  await sheet.getByRole('button', { name: 'Change roles' }).click()
  const rolesDialog = owner.getByRole('dialog', { name: /roles$/ })
  await rolesDialog.getByLabel('Role in Sales').selectOption('department_manager')
  await rolesDialog.getByRole('button', { name: 'Save roles' }).click()
  await expect(sheet.getByText('Department Manager · Sales')).toBeVisible()

  // The promotion is real: she can now review requests, and sees that the sheet's move is too.
  await teammate.goto(`/org/${orgId}/requests`)
  await expect(teammate.getByRole('heading', { name: 'Join requests' })).toBeVisible()

  // Moving out of Sales previews what ends, then ends it.
  await sheet.getByRole('button', { name: 'Take Amy Applicant out of Engineering' }).click()
  const leaveDialog = owner.getByRole('dialog', { name: /out of Engineering\?/ })
  await leaveDialog.getByRole('button', { name: 'Take out of department' }).click()
  await expect(sheet.getByRole('button', { name: /out of Engineering/ })).toHaveCount(0)

  await sheet.getByRole('button', { name: 'Move Amy Applicant out of Sales' }).click()
  const moveDialog = owner.getByRole('dialog', { name: 'Move Amy Applicant' })
  await moveDialog.getByLabel('Move from Sales to').selectOption({ label: 'Engineering' })
  await expect(moveDialog.getByText('Sales will have no Department Manager.')).toBeVisible()
  await moveDialog.getByRole('button', { name: 'Move member' }).click()
  await expect(sheet.getByText('Department Manager · Sales')).toHaveCount(0)
  await teammate.goto(`/org/${orgId}/departments`)
  await expect(teammate.getByRole('heading', { name: 'Engineering', level: 2 })).toBeVisible()
  await expect(teammate.getByRole('heading', { name: 'Sales', level: 2 })).toBeHidden()

  // Suspending reaches a page that's already open, on its next request.
  await teammate.goto(`/org/${orgId}/members`)
  await expect(teammate.getByRole('heading', { name: 'Members' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Suspend' }).click()
  const suspendDialog = owner.getByRole('dialog', { name: 'Suspend Amy Applicant?' })
  await expect(suspendDialog.getByText('Access paused')).toBeVisible()
  await suspendDialog.getByLabel(/Reason/).fill('Extended leave')
  await suspendDialog.getByRole('button', { name: 'Suspend member' }).click()
  await expect(sheet.getByText('Suspended')).toBeVisible()

  await teammate.getByLabel('Search members by name or email').fill('Olivia')
  await expect(teammate.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await teammate.goto('/')
  await expect(teammate.getByRole('heading', { name: /^Hi, / })).toBeVisible()

  await sheet.getByRole('button', { name: 'Reactivate' }).click()
  await expect(sheet.getByRole('button', { name: 'Suspend' })).toBeVisible()
  await teammate.goto(`/org/${orgId}`)
  await expect(teammate.getByRole('heading', { level: 1, name: orgName })).toBeVisible()

  // Ownership needs the password, and swaps who is protected from whom.
  await sheet.getByRole('button', { name: 'Make Owner' }).click()
  const ownerDialog = owner.getByRole('dialog', { name: /the Owner\?/ })
  await ownerDialog.getByLabel('Your password').fill('not the password')
  await ownerDialog.getByRole('button', { name: 'Transfer ownership' }).click()
  await expect(ownerDialog.getByText("That password isn't correct.")).toBeVisible()
  await ownerDialog.getByLabel('Your password').fill(PASSWORD)
  await ownerDialog.getByRole('button', { name: 'Transfer ownership' }).click()
  await expect(ownerDialog).toBeHidden()
  await expect(owner.getByRole('button', { name: 'Manage Amy Applicant' })).toHaveCount(0)

  // The new Owner removes the old one, who loses everything at once.
  await teammate.goto(`/org/${orgId}/members`)
  await teammate.getByRole('button', { name: 'Manage Olivia Owner' }).click()
  await teammate.getByRole('button', { name: 'Remove from organization' }).click()
  const removeDialog = teammate.getByRole('dialog', { name: 'Remove Olivia Owner?' })
  await removeDialog.getByRole('button', { name: 'Remove member' }).click()
  await expect(teammate.getByRole('button', { name: 'Manage Olivia Owner' })).toHaveCount(0)
  await owner.goto(`/org/${orgId}`)
  await expect(owner.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  // All of it is on the record.
  await teammate.goto(`/org/${orgId}/activity`)
  await expect(teammate.getByText('removed Olivia Owner')).toBeVisible()
  await expect(teammate.getByText('transferred ownership to Amy Applicant')).toBeVisible()
  await expect(teammate.getByText('suspended Amy Applicant')).toBeVisible()
  await expect(teammate.getByText('moved Amy Applicant from Sales to Engineering')).toBeVisible()
})

test('member sheet and dialogs have no detectable accessibility violations', async ({
  browser,
}, testInfo) => {
  const orgName = `Sheet ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner5')
  const teammate = await newUser(browser, testInfo, 'Amy Applicant', 'teammate2')
  const orgId = await createOrganization(owner, orgName, false)

  await owner.goto(`/org/${orgId}/invitations`)
  await owner.getByRole('button', { name: 'Create link' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()
  await teammate.goto(new URL(link).pathname)
  await teammate.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(teammate.getByRole('heading', { level: 1, name: orgName })).toBeVisible()

  const check = async (label: string) => {
    await owner.waitForTimeout(300) // let the sheet or dialog finish animating in
    const results = await new AxeBuilder({ page: owner })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${label}: ${results.violations.map((v) => `${v.id} ${v.nodes[0]?.html.slice(0, 120)}`).join(' | ')}`,
    ).toEqual([])
  }

  await owner.goto(`/org/${orgId}/members`)
  await owner.getByRole('button', { name: 'Manage Amy Applicant' }).click()
  const sheet = owner.getByRole('dialog', { name: 'Amy Applicant' })
  await expect(sheet).toBeVisible()
  await check('member sheet')

  await sheet.getByRole('button', { name: 'Suspend' }).click()
  const suspendDialog = owner.getByRole('dialog', { name: 'Suspend Amy Applicant?' })
  await expect(suspendDialog.getByText('Personal tasks')).toBeVisible()
  await check('impact preview')
  await owner.keyboard.press('Escape')
  await expect(suspendDialog).toBeHidden()

  await sheet.getByRole('button', { name: 'Change roles' }).click()
  await expect(owner.getByRole('dialog', { name: /roles$/ })).toBeVisible()
  await check('roles dialog')
  await owner.keyboard.press('Escape')

  await sheet.getByRole('button', { name: 'Make Owner' }).click()
  await expect(owner.getByRole('dialog', { name: /the Owner\?/ })).toBeVisible()
  await check('ownership dialog')
  await owner.emulateMedia({ colorScheme: 'dark' })
  await check('ownership dialog in dark mode')
})

test('organization pages have no detectable accessibility violations', async ({
  browser,
}, testInfo) => {
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner3')
  const orgId = await createOrganization(owner, `A11y ${testInfo.project.name} ${Date.now()}`, true)

  for (const path of [
    '/organizations/new',
    '/organizations/join',
    `/org/${orgId}`,
    `/org/${orgId}/departments`,
    `/org/${orgId}/members`,
    `/org/${orgId}/requests`,
    `/org/${orgId}/invitations`,
    `/org/${orgId}/activity`,
    `/org/${orgId}/settings`,
  ]) {
    await owner.goto(path)
    await expect(owner.locator('h1').first()).toBeVisible()
    await owner.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page: owner })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${path}: ${results.violations.map((v) => `${v.id} ${v.nodes[0]?.html.slice(0, 120)}`).join(' | ')}`,
    ).toEqual([])
  }
})
