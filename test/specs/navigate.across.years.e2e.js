import { test, expect } from '@playwright/test'
import { ChooseYearPage } from 'page-objects/choose.year.page.js'
import { DashboardPage } from 'page-objects/dashboard.page.js'
import { HomePage } from 'page-objects/homepage.js'
import { ReportDetailPage } from 'page-objects/reports/report.detail.page.js'
import { ReportsPage } from 'page-objects/reports/reports.page.js'
import { TonnesRecycledPage } from 'page-objects/reports/tonnes.recycled.page.js'
import { WasteRecordsPage } from 'page-objects/waste.records.page.js'
import { seedOrganisationAcrossYears } from '~/test/support/seeding/organisation.js'
import { createLinkAndLogin } from '~/test/support/login-helper.js'
import { currentYear } from '~/test/support/date.js'
import { defraIdStub } from '~/test/support/defra-id-stub.js'
import { fetchYearCalendar } from '~/test/support/seeding/year-calendar.js'
import {
  submitSummaryLogContent,
  summaryLogDatedAt
} from '~/test/support/seeding/summary-logs.js'
import { summaryLogContentNumbered } from '~/test/support/spreadsheet/summarylogs-content-generator.js'

/**
 * @param {{ reportingPeriods: { year: number }[] } | undefined} kind
 * @param {number} year
 */
const expectReportsOnlyFor = (kind, year) =>
  expect(
    new Set(kind?.reportingPeriods.map((period) => period.year))
  ).toStrictEqual(new Set([year]))

test.describe('Navigate across years @navigateAcrossYears', () => {
  test.describe('organisation home', () => {
    test('Organisation home page defaults to the latest year with an active registration', async ({
      page
    }) => {
      const dashboardPage = new DashboardPage(page)
      const { refNo, email } = await seedOrganisationAcrossYears()

      await createLinkAndLogin(page, refNo, email)

      await expect(dashboardPage.yearHeading()).toHaveText(
        `This is ${currentYear()} data`
      )
      expect(await dashboardPage.getRegistrationStatus(1, 1)).toBe('Approved')
      expect(await dashboardPage.getAccreditationStatus(1, 1)).toBe('Approved')
    })

    test('Choosing a different year shows the organisation as it was then', async ({
      page
    }) => {
      const dashboardPage = new DashboardPage(page)
      const chooseYearPage = new ChooseYearPage(page)
      const { refNo, email, organisationNumber, registrationNumber } =
        await seedOrganisationAcrossYears()
      const yearSelected = currentYear() - 1

      const user = await createLinkAndLogin(page, refNo, email)
      await dashboardPage.chooseDifferentYearLink().click()

      await expect(chooseYearPage.yearOption(currentYear())).not.toBeChecked()

      await chooseYearPage.yearOption(yearSelected).check()
      await chooseYearPage.continueButton().click()

      await expect(page).toHaveURL(
        new RegExp(`/organisations/\\d+/${yearSelected}$`)
      )
      await expect(dashboardPage.yearHeading()).toHaveText(
        `This is ${yearSelected} data`
      )
      expect(await dashboardPage.getRegistrationStatus(1, 1)).toBe('Approved')
      expect(await dashboardPage.getAccreditationStatus(1, 1)).toBe(
        'Not accredited'
      )

      const { registeredOnly, accredited } = await fetchYearCalendar(
        { organisationNumber, registrationNumber, year: yearSelected },
        defraIdStub.authHeader(user.userId)
      )
      expectReportsOnlyFor(registeredOnly, yearSelected)
      expect(accredited).toBeUndefined()
    })
  })

  // The previous year is registered-only, with Quarter 1 holding loads; this
  // year is accredited.
  test.describe.serial('reports for a chosen year', () => {
    const year = currentYear() - 1

    /** @type {import('@playwright/test').Page} */
    let page
    let organisationNumber

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage()
      const seeded = await seedOrganisationAcrossYears({
        reprocessingType: 'output'
      })
      organisationNumber = seeded.organisationNumber

      const user = await createLinkAndLogin(page, seeded.refNo, seeded.email)
      await submitSummaryLogContent(
        seeded.refNo,
        seeded.registrationId,
        defraIdStub.authHeader(user.userId),
        await summaryLogContentNumbered(
          await summaryLogDatedAt(
            'resources/reprocessor-output-regonly.xlsx',
            new Date(Date.UTC(year, 1, 15, 12))
          ),
          { regNumber: seeded.registrationNumber }
        ),
        year
      )
    })

    test.afterAll(async () => {
      await new HomePage(page).signOutLink().click()
      await page.close()
    })

    test('Manage reports carries the year chosen on home', async () => {
      const dashboardPage = new DashboardPage(page)
      const chooseYearPage = new ChooseYearPage(page)
      const wasteRecordsPage = new WasteRecordsPage(page)
      const reportsPage = new ReportsPage(page)

      await dashboardPage.chooseDifferentYearLink().click()
      await chooseYearPage.yearOption(year).check()
      await chooseYearPage.continueButton().click()
      await dashboardPage.expectYear(year)

      await dashboardPage.selectTableLink(1, 1)
      await wasteRecordsPage.expectYear(year)

      await wasteRecordsPage.manageReportsLink().click()
      await reportsPage.expectListFor(year)
      expect(await reportsPage.getActivePeriodLabel(1)).toBe(
        `Quarter 1, ${year}`
      )
    })

    test('Leaving a report keeps the chosen year', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const tonnesRecycledPage = new TonnesRecycledPage(page)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.expectPeriodYear(year)
      await reportDetailPage.cancelAndReturnToReports()
      await reportsPage.expectListFor(year)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()
      await tonnesRecycledPage.expectPeriodYear(year)
      await tonnesRecycledPage.backLink().click()
      await reportsPage.expectListFor(year)
    })

    test('Back from the reports list returns to the chosen year', async () => {
      await new ReportsPage(page).backLink().click()
      await new WasteRecordsPage(page).expectYear(year)
    })

    test('Changing year from home moves the reports with it', async () => {
      const dashboardPage = new DashboardPage(page)
      const chooseYearPage = new ChooseYearPage(page)
      const wasteRecordsPage = new WasteRecordsPage(page)

      await dashboardPage.open(organisationNumber)
      await dashboardPage.chooseDifferentYearLink().click()
      await chooseYearPage.yearOption(currentYear()).check()
      await chooseYearPage.continueButton().click()
      await dashboardPage.expectYear(currentYear())

      await dashboardPage.selectTableLink(1, 1)
      await wasteRecordsPage.expectYear(currentYear())
      await expect(page).toHaveURL(
        new RegExp(`/accreditations/${currentYear()}$`)
      )

      await wasteRecordsPage.manageReportsLink().click()
      await new ReportsPage(page).expectListFor(currentYear())
    })
  })
})
