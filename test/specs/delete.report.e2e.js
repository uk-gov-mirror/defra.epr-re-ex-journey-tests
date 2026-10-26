import { test, expect } from '@playwright/test'
import { HomePage } from 'page-objects/homepage.js'
import { DashboardPage } from '../page-objects/dashboard.page.js'
import { WasteRecordsPage } from '../page-objects/waste.records.page.js'
import { ReportsPage } from 'page-objects/reports/reports.page.js'
import { ReportDetailPage } from 'page-objects/reports/report.detail.page.js'
import { TonnesRecycledPage } from '../page-objects/reports/tonnes.recycled.page.js'
import { TonnesNotRecycledPage } from '../page-objects/reports/tonnes.not.recycled.page.js'
import { ReprocessorPrnSummaryPage } from '../page-objects/reports/reprocessor.prn.summary.page.js'
import { FreePrnsPage } from '../page-objects/reports/free.prns.page.js'
import { ReportSupportingInformationPage } from 'page-objects/reports/report.supporting.information.page.js'
import { ReportCheckAnswersPage } from 'page-objects/reports/report.check.answers.page.js'
import { MonthlyReportDraftDeclarationPage } from '../page-objects/reports/monthly.report.draft.declaration.page.js'
import { ConfirmDeleteReportPage } from '../page-objects/confirm.delete.report.page.js'
import { checkBodyText } from '../support/checks.js'
import {
  createLinkedOrganisation,
  updateMigratedOrganisation
} from '../support/seeding/organisation.js'
import {
  registrationStartYear,
  submitSummaryLogContent
} from '../support/seeding/summary-logs.js'
import { generateNumbers } from '../support/reg-acc-number.js'
import { summaryLogContentNumbered } from '../support/spreadsheet/summarylogs-content-generator.js'
import { defraIdStub } from '../support/defra-id-stub.js'
import { expectActionRequiredStatus } from '../support/report-status.js'
import { createLinkAndLogin } from '../support/login-helper.js'
import { currentYear } from '~/test/support/date.js'

async function setupReprocessor(page) {
  const { regNumber, accNumber } = generateNumbers({
    wasteProcessingType: 'reprocessor',
    materialSuffix: 'PL'
  })

  const organisationDetails = await createLinkedOrganisation([
    {
      material: 'Plastic (R3)',
      wasteProcessingType: 'Reprocessor'
    }
  ])

  const migrationResponse = await updateMigratedOrganisation(
    organisationDetails.refNo,
    [
      {
        reprocessingType: 'output',
        regNumber,
        accNumber,
        status: 'approved'
      }
    ]
  )

  const user = await createLinkAndLogin(
    page,
    organisationDetails.refNo,
    migrationResponse.email
  )

  // Seed the summary log via epr-backend's dev endpoint rather than a real
  // multipart upload: this journey is about deleting reports, not the
  // upload itself, which the dedicated summary-log specs already cover.
  const summaryLogContent = await summaryLogContentNumbered(
    'resources/sanity/reprocessorOutput_A26ER5000000001PL_R26ER5000000001PL.xlsx',
    { regNumber, accNumber }
  )
  await submitSummaryLogContent(
    organisationDetails.refNo,
    migrationResponse.registrationIds[0],
    defraIdStub.authHeader(user.userId),
    summaryLogContent,
    registrationStartYear()
  )

  const dashboardPage = new DashboardPage(page)
  const wasteRecordsPage = new WasteRecordsPage(page)
  await dashboardPage.selectTableLink(1, 1)
  await wasteRecordsPage.manageReportsLink().click()
}

async function navigateReprocessorToSupportingInfo(page) {
  const tonnesRecycledPage = new TonnesRecycledPage(page)
  const tonnesNotRecycledPage = new TonnesNotRecycledPage(page)
  const reprocessorPrnSummaryPage = new ReprocessorPrnSummaryPage(page)
  const freePrnsPage = new FreePrnsPage(page)

  await tonnesRecycledPage.enterTonnage('10')
  await tonnesRecycledPage.continue()
  await tonnesNotRecycledPage.enterTonnage('5')
  await tonnesNotRecycledPage.continue()
  await reprocessorPrnSummaryPage.enterRevenue('100')
  await reprocessorPrnSummaryPage.continue()
  await freePrnsPage.enterTonnage('0')
  await freePrnsPage.continue()
}

test.describe.serial('Deleting reports', () => {
  /** @type {import('@playwright/test').Page} */
  let page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await setupReprocessor(page)
  })

  test.afterAll(async () => {
    const homePage = new HomePage(page)
    await homePage.signOutLink().click()
    await expect(page).toHaveTitle(/Signed out/)
    await page.close()
  })

  test('should delete from the submit page @deleteReport', async () => {
    const reportsPage = new ReportsPage(page)
    const reportDetailPage = new ReportDetailPage(page)
    const reportSupportingInformationPage = new ReportSupportingInformationPage(
      page
    )
    const reportCheckAnswersPage = new ReportCheckAnswersPage(page)
    const monthlyReportDraftDeclarationPage =
      new MonthlyReportDraftDeclarationPage(page)
    const confirmDeleteReportPage = new ConfirmDeleteReportPage(page)

    // Navigate to reports and create a draft report
    await reportsPage.selectActiveActionLink(1)
    await reportDetailPage.useThisData()

    // Navigate through reprocessor data entry pages
    await navigateReprocessorToSupportingInfo(page)
    await reportSupportingInformationPage.continue()

    // Create the draft report (transitions to ready_to_submit)
    await reportCheckAnswersPage.createReport()

    // Confirmation page — go back to reports list
    await checkBodyText(page, 'report created', 30)
    await page.locator('a', { hasText: 'Go to reports' }).click()

    // Report should now be ready to submit — click into it
    const statusBefore = await reportsPage.getActiveStatusBadge(1)
    const colourBefore = await reportsPage.getActiveStatusColour(1)

    expect(statusBefore).toBe('Ready to submit')
    expect(colourBefore).toBe('blue')

    await reportsPage.selectActiveActionLink(1)

    // On the submit/declaration page — click delete report
    await monthlyReportDraftDeclarationPage.deleteReport().click()

    // Verify confirm deletion page
    const deleteHeading = await confirmDeleteReportPage.headingText()
    expect(deleteHeading).toBe('Confirm deletion of this report')

    const warningText = await confirmDeleteReportPage.warningText()
    expect(warningText).toContain('This action cannot be undone')

    // Confirm deletion
    await confirmDeleteReportPage.confirmDeletion()

    // Should be back on reports list with status reverted to due
    await reportsPage.expectListFor(currentYear())

    await expectActionRequiredStatus(page, 1)
  })
})
