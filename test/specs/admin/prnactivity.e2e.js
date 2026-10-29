import { test, expect } from '@playwright/test'

import { AdminLoginPage } from 'page-objects/admin/login.page'
import { Navigation } from 'page-objects/admin/navigation.page'
import { OrganisationsPage } from 'page-objects/admin/organisations.page'
import { OrganisationOverviewPage } from 'page-objects/admin/organisation.overview.page'
import { PrnActivityPage } from 'page-objects/admin/prn.activity.page'
import { RegistrationOverviewPage } from 'page-objects/admin/registration.overview.page'
import { RegistrationYearPage } from 'page-objects/admin/registration.year.page'
import { parseCsvBody } from '../../support/csv.js'
import { seedAdminActivityData } from '../../support/seeding/admin-activity.js'
test.describe('PRN activity page', () => {
  /** @type {Awaited<ReturnType<typeof seedAdminActivityData>>} */
  let seeded

  test.beforeAll(async () => {
    seeded = await seedAdminActivityData()
  })

  test('Should list an accepted PRN and allow a CSV download @prnActivity', async ({
    page
  }) => {
    const loginPage = new AdminLoginPage(page)
    const navigation = new Navigation(page)
    const prnActivityPage = new PrnActivityPage(page)

    await loginPage.open()
    await expect(page).toHaveTitle(/Login/)
    await loginPage.enterCredentials('ea@test.gov.uk', 'pass')
    await loginPage.submitCredentials()

    await navigation.clickOnLink('PRN activity')

    const heading = await prnActivityPage.getHeaderText()
    expect(heading).toBe('PRN activity')

    const tableText = await prnActivityPage.tableText()
    expect(tableText).toContain(seeded.prnNumber)
    expect(tableText).toContain('accepted')
    expect(tableText).toContain(seeded.accreditationNumber)
    expect(tableText).toContain(String(seeded.tonnage))

    const csv = await prnActivityPage.fetchCsv()
    expect(csv.status).toEqual(200)
    expect(csv.contentType).toContain('text/csv')
    expect(csv.contentDisposition).toContain('attachment')
    expect(csv.contentDisposition).toContain('prn-activity.csv')
    expect(csv.body).toContain('PRN Number')
    expect(csv.body).toContain(seeded.prnNumber)
    expect(csv.body).toContain(seeded.accreditationNumber)
  })

  test("Should download one accreditation's PRN activity from its accreditation year page @prnActivity", async ({
    page
  }) => {
    const loginPage = new AdminLoginPage(page)
    const organisationsPage = new OrganisationsPage(page)
    const organisationOverviewPage = new OrganisationOverviewPage(page)
    const registrationOverviewPage = new RegistrationOverviewPage(page)
    const registrationYearPage = new RegistrationYearPage(page)

    await loginPage.loginAsServiceMaintainer()
    await organisationsPage.open()
    await organisationsPage.searchFor(seeded.companyName)
    await organisationsPage.viewLink(1)
    await organisationOverviewPage.viewRegistrationLink(1)
    await registrationOverviewPage.viewYear(seeded.accreditationYear)

    const csv = await registrationYearPage.download(
      registrationYearPage.prnActivityDownloadLink()
    )
    expect(csv.failure).toBeNull()
    expect(csv.filename).toEqual(
      `prn-activity-${seeded.registrationNumber}-${seeded.accreditationYear}.csv`
    )

    const [header, ...rows] = parseCsvBody(csv.body.toString('utf8'))
    expect(header).toEqual([
      'PRN Number',
      'Status',
      'Issued To',
      'Tonnage',
      'Material',
      'Process To Be Used',
      'December Waste',
      'Issued Date',
      'Issued By',
      'Position',
      'Accreditation Number',
      'Accreditation Year',
      'Obligation Year',
      'Submitted To Regulator',
      'Organisation Name',
      'Waste Processing Type'
    ])
    // The issue date is checked by shape alone, because UTC and UK time can
    // name different days around midnight.
    expect(rows).toEqual([
      [
        seeded.prnNumber,
        'accepted',
        'Trading Name',
        String(seeded.tonnage),
        'paper',
        'R3',
        'No',
        expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/),
        seeded.issuedBy,
        '',
        seeded.accreditationNumber,
        String(seeded.accreditationYear),
        String(seeded.accreditationYear),
        'sepa',
        seeded.companyName,
        'reprocessor'
      ]
    ])
  })
})
