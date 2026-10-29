import { test, expect } from '@playwright/test'

import { AdminLoginPage } from 'page-objects/admin/login.page'
import { OrganisationsPage } from 'page-objects/admin/organisations.page'
import { OrganisationOverviewPage } from 'page-objects/admin/organisation.overview.page'
import { RegistrationOverviewPage } from 'page-objects/admin/registration.overview.page'
import { RegistrationYearPage } from 'page-objects/admin/registration.year.page'
import { ReportViewPage } from 'page-objects/admin/report.view.page'
import { seedOrganisationAcrossYears } from '../../support/seeding/organisation.js'
import { seedReportSubmission } from '../../support/seeding/reports.js'
import {
  submitSummaryLogContent,
  summaryLogDatedAt
} from '../../support/seeding/summary-logs.js'
import { registerAndLinkDefraIdUser } from '../../support/defra-id-linking.js'
import { defraIdStub } from '../../support/defra-id-stub.js'
import { summaryLogContentNumbered } from '../../support/spreadsheet/summarylogs-content-generator.js'
import { currentYear } from '../../support/date.js'

// The registration is registered-only for the two years before this one and
// accredited this year. Last year holds a summary log and a submitted Quarter 1
// report, both in periods that have ended whatever today's date. The dev
// endpoint stamps the log with this year's accreditation, so it lands invalid;
// the journey only needs it listed under its own year.
test.describe('Registration overview years', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 })

  test('An admin moves between a registration years and sees each year on its own page @organisations', async ({
    page
  }) => {
    const organisationsPage = new OrganisationsPage(page)
    const organisationOverviewPage = new OrganisationOverviewPage(page)
    const registrationOverviewPage = new RegistrationOverviewPage(page)
    const registrationYearPage = new RegistrationYearPage(page)
    const reportViewPage = new ReportViewPage(page)

    const thisYear = currentYear()
    const lastYear = thisYear - 1
    const firstYear = thisYear - 2

    const seeded = await seedOrganisationAcrossYears({
      reprocessingType: 'output'
    })
    const user = await registerAndLinkDefraIdUser(seeded.refNo, seeded.email)
    const defraAuthHeader = defraIdStub.authHeader(user.userId)

    await submitSummaryLogContent(
      seeded.refNo,
      seeded.registrationId,
      defraAuthHeader,
      await summaryLogContentNumbered(
        await summaryLogDatedAt(
          'resources/reprocessor-output-regonly.xlsx',
          new Date(Date.UTC(lastYear, 1, 15, 12))
        ),
        { regNumber: seeded.registrationNumber }
      ),
      lastYear
    )
    await seedReportSubmission(
      seeded.refNo,
      seeded.registrationId,
      defraAuthHeader,
      { year: lastYear, cadence: 'quarterly', period: 1, submissionNumber: 1 }
    )

    const heading = (year, kind) =>
      `${seeded.companyName} - ${seeded.registrationNumber} - ${year} ${kind}`

    await test.step('The overview lists every year, newest first', async () => {
      await new AdminLoginPage(page).loginAsServiceMaintainer()
      await organisationsPage.open()
      await organisationsPage.searchFor(seeded.companyName)
      await organisationsPage.viewLink(1)
      await organisationOverviewPage.viewRegistrationLink(1)

      expect(await registrationOverviewPage.getYearsTableData()).toEqual([
        {
          year: `${thisYear}`,
          registrationStatus: 'approved',
          accreditationStatus: 'approved',
          accreditationNumber: seeded.accreditationNumber
        },
        {
          year: `${lastYear}`,
          registrationStatus: 'approved',
          accreditationStatus: 'Not accredited',
          accreditationNumber: '-'
        },
        {
          year: `${firstYear}`,
          registrationStatus: 'approved',
          accreditationStatus: 'Not accredited',
          accreditationNumber: '-'
        }
      ])
    })

    await test.step('A registered-only year shows only that year', async () => {
      await registrationOverviewPage.viewYear(lastYear)

      await expect(page).toHaveURL(new RegExp(`/registered-only/${lastYear}$`))
      expect(await registrationYearPage.getHeaderText()).toEqual(
        heading(lastYear, 'registered only')
      )
      await expect(registrationYearPage.prnActivityDownloadLink()).toHaveCount(
        0
      )
      await expect(registrationYearPage.viewORSLink()).toHaveCount(0)

      const reports = await registrationYearPage.getReportsTableData()
      expect(reports.map((row) => row.period).sort()).toEqual([
        'Quarter 1',
        'Quarter 2',
        'Quarter 3',
        'Quarter 4'
      ])
      const quarterOneRow =
        reports.findIndex((row) => row.period === 'Quarter 1') + 1
      expect(reports[quarterOneRow - 1]).toMatchObject({
        submission: '1',
        status: 'Submitted'
      })

      expect(
        (await registrationYearPage.getSummaryLogActionLinks(1)).map(
          (link) => link.text
        )
      ).toEqual(['View data', 'Download'])
    })

    await test.step('A report opens and returns to its year', async () => {
      const reports = await registrationYearPage.getReportsTableData()
      await registrationYearPage.clickOnViewReportLink(
        reports.findIndex((row) => row.period === 'Quarter 1') + 1
      )

      expect(await reportViewPage.getHeaderText()).toEqual(
        `Report – ${lastYear} quarterly period 1 submission 1`
      )
      expect(await reportViewPage.breadcrumbs()).toEqual([
        'Organisations',
        'Organisation overview',
        'Registration overview',
        `${lastYear}`
      ])

      await reportViewPage.crumbLink(`${lastYear}`).click()
      expect(await registrationYearPage.getHeaderText()).toEqual(
        heading(lastYear, 'registered only')
      )
    })

    await test.step('The accredited year shows its accreditation and none of last year', async () => {
      await registrationYearPage.crumbLink('Registration overview').click()
      await registrationOverviewPage.viewYear(thisYear)

      await expect(page).toHaveURL(new RegExp(`/accreditations/${thisYear}$`))
      expect(await registrationYearPage.getHeaderText()).toEqual(
        heading(thisYear, 'accredited')
      )
      await expect(registrationYearPage.prnActivityDownloadLink()).toBeVisible()
      expect(await registrationYearPage.getSummaryLogsContent()).toContain(
        'No summary logs'
      )
    })

    await test.step('A year opened as the wrong kind is not found', async () => {
      const response = await page.goto(
        page
          .url()
          .replace(`/accreditations/${thisYear}`, `/accreditations/${lastYear}`)
      )
      expect(response?.status()).toBe(404)
    })
  })
})
