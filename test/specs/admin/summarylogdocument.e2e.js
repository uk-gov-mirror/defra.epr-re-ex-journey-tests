import { test, expect } from '@playwright/test'

import { AdminLoginPage } from 'page-objects/admin/login.page'
import { OrganisationsPage } from 'page-objects/admin/organisations.page'
import { OrganisationOverviewPage } from 'page-objects/admin/organisation.overview.page'
import { RegistrationOverviewPage } from 'page-objects/admin/registration.overview.page'
import { RegistrationYearPage } from 'page-objects/admin/registration.year.page'
import { SummaryLogDocumentPage } from 'page-objects/admin/summary.log.document.page'
import { seedAdminActivityData } from '../../support/seeding/admin-activity.js'

// The shared seed uploads and submits a real reprocessor summary log (so its
// document carries a populated loadsByReportingPeriod); keep the generous
// timeout the other summary-log admin specs use.
test.describe('Admin summary log document view', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 })

  let seeded

  test.beforeAll(async () => {
    seeded = await seedAdminActivityData()
  })

  // Reaches the year page holding the seeded reprocessor's summary log through
  // the admin UI (search -> organisation -> registration -> year), returning
  // the page object positioned on that year page.
  const openRegistrationYear = async (page) => {
    const loginPage = new AdminLoginPage(page)
    const organisationsPage = new OrganisationsPage(page)
    const organisationOverviewPage = new OrganisationOverviewPage(page)
    const registrationOverviewPage = new RegistrationOverviewPage(page)

    await loginPage.loginAsServiceMaintainer()
    await organisationsPage.open()
    await organisationsPage.searchFor(seeded.companyName)
    await organisationsPage.viewLink(1)
    await organisationOverviewPage.viewRegistrationLink(1)
    await registrationOverviewPage.viewYear(seeded.accreditationYear)

    return new RegistrationYearPage(page)
  }

  test('An admin opens a submitted summary log as pretty-printed JSON from the registration year page @summaryLogDocument', async ({
    page
  }) => {
    const registrationYearPage = await openRegistrationYear(page)
    const summaryLogDocumentPage = new SummaryLogDocumentPage(page)

    // The Actions column offers View data alongside Download.
    const actionLinks = await registrationYearPage.getSummaryLogActionLinks(1)
    expect(actionLinks.map((link) => link.text)).toEqual([
      'View data',
      'Download'
    ])

    await registrationYearPage.clickViewSummaryLogData(1)

    // The document page names itself.
    expect(await summaryLogDocumentPage.getHeaderText()).toEqual('Summary log')

    // The whole stored document is rendered verbatim: its version, its
    // submitted status, and the loadsByReportingPeriod breakdown the page
    // exists to surface - open and closed period loads, their balance-affecting
    // tonnage deltas, and the closed periods.
    const document = await summaryLogDocumentPage.getDocument()
    expect(document.version).toBeDefined()
    expect(document.status).toBe('submitted')

    const loads = document.loadsByReportingPeriod
    expect(loads).toMatchObject({
      openPeriodLoads: {
        added: { balanceAffecting: { count: expect.any(Number) } }
      },
      closedPeriodLoads: {
        added: { balanceAffecting: { count: expect.any(Number) } }
      },
      closedPeriods: expect.any(Array)
    })
    expect(
      loads.openPeriodLoads.added.balanceAffecting.tonnageDelta
    ).toBeGreaterThan(0)
  })
})
