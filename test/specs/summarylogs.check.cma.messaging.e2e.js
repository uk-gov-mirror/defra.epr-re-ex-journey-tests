import { test, expect } from '@playwright/test'
import { HomePage } from 'page-objects/homepage.js'
import { UploadSummaryLogPage } from '../page-objects/upload.summary.log.page.js'
import { CheckSummaryLogPage } from '../page-objects/check.summary.log.page.js'
import { WasteRecordsPage } from '../page-objects/waste.records.page.js'
import { DashboardPage } from '../page-objects/dashboard.page.js'
import { ReportsPage } from '../page-objects/reports/reports.page.js'
import { checkBodyText } from '../support/checks.js'
import {
  createLinkedOrganisation,
  updateMigratedOrganisation
} from '../support/seeding/organisation.js'
import { seedSubmittedReport } from '../support/seeding/reports.js'
import { summaryLogNumbered } from '../support/seeding/summary-logs.js'
import { generateRegNumber } from '../support/reg-acc-number.js'
import {
  registerAndLinkDefraIdUser,
  loginViaHomePage
} from '../support/login-helper.js'
import { currentYear } from '~/test/support/date.js'

// PAE-1648 closed-period adjustment messaging copy (en.json
// summary-log:closedPeriodAdjustments), asserted verbatim by the closed-period
// messaging tests below.
const IMPORTANT_BODY =
  "If you upload this summary log, you'll need to create a new report for any relevant period and an approved person from your business will need to resubmit it to your regulator."
const FURTHER_ACTION_HEADING = 'Further action needed'
const FURTHER_ACTION_PARA_1 =
  "Data from a period that you had already reported on has been changed, so you'll need to create a new report."
const FURTHER_ACTION_PARA_2 =
  'Once the new report has been created, an approved person from your business will need to submit it to your regulator.'
const FURTHER_ACTION_PARA_3 =
  "Reports that need to be resubmitted to your regulator show the status 'Requires resubmission' on the reports page."

// Split from summarylogs.check.cma.e2e.js (PAE-1405 CI runtime work): this
// group covers the "Important" banner and "Further action needed" messaging
// that renders when closed-period adjustments are detected. See
// summarylogs.check.cma.sections.e2e.js for open/closed section visibility
// and summarylogs.check.cma.adjusted-loads.e2e.js for adjusted-load sub-state
// rendering. The "no closed-period adjustments" control case lives in
// summarylogs.exporter.e2e.js instead (see comment below).
test.describe('Summary Logs - Check Page with CMA Detection - Closed-period Adjustment Messaging', () => {
  test('should show the Important banner and Further action needed messaging when closed-period adjustments are detected @closedPeriodMessaging @cma', async ({
    page
  }) => {
    const homePage = new HomePage(page)
    const uploadSummaryLogPage = new UploadSummaryLogPage(page)
    const checkSummaryLogPage = new CheckSummaryLogPage(page)
    const wasteRecordsPage = new WasteRecordsPage(page)
    const dashboardPage = new DashboardPage(page)

    const organisationDetails = await createLinkedOrganisation([
      {
        material: 'Paper or board (R3)',
        wasteProcessingType: 'Reprocessor',
        withoutAccreditation: true
      }
    ])
    const regNumber = generateRegNumber({
      wasteProcessingType: 'reprocessor',
      materialSuffix: 'PA'
    })

    const migrationResponse = await updateMigratedOrganisation(
      organisationDetails.refNo,
      [
        {
          reprocessingType: 'output',
          regNumber,
          status: 'approved',
          withoutAccreditation: true
        }
      ]
    )

    const user = await registerAndLinkDefraIdUser(
      organisationDetails.refNo,
      migrationResponse.email
    )

    const regId = migrationResponse.registrationIds[0]

    await seedSubmittedReport(
      organisationDetails.refNo,
      regId,
      user.userId,
      2026,
      'quarterly',
      1,
      1,
      { tonnageRecycled: 100, tonnageNotRecycled: 0 }
    )

    await loginViaHomePage(page, migrationResponse.email)

    await dashboardPage.selectLink(1)

    await wasteRecordsPage.submitSummaryLogLink().click()

    await uploadSummaryLogPage.uploadFile(
      await summaryLogNumbered(
        'resources/reprocessor-output-regonly-cma.xlsx',
        { regNumber }
      )
    )
    await uploadSummaryLogPage.continue()

    await checkBodyText(page, 'Your summary log is being checked', 30)
    await checkBodyText(page, 'Upload your summary log', 30)

    // The "Important" banner is shown on the check before you submit page.
    const banner = checkSummaryLogPage.importantBanner()
    expect((await banner.count()) > 0).toBe(true)
    const bannerText = await banner.innerText()
    expect(bannerText).toContain('Important')
    expect(bannerText).toContain(IMPORTANT_BODY)

    // Merged from summarylogs.check.cma.sections.e2e.js's cmaDetected case
    // (same org/upload setup, duplicated purely to assert the closed-period
    // section heading and sub-state content on this same check page).
    await checkBodyText(page, 'Closed periods: new loads', 30)
    const subStates = (await checkSummaryLogPage.allSubStateHeadings()).join(
      ' | '
    )
    expect(subStates).toContain('8 new loads will be recorded')
    await checkBodyText(page, 'These have been added to your summary log.', 30)

    // Submit inline (not performUploadAndReturnToHomepage, which would click
    // "Return to home" and skip the success-page assertions below).
    await checkSummaryLogPage.uploadButton().click()

    await checkBodyText(page, 'Your waste records are being updated', 30)
    await checkBodyText(page, 'Summary log uploaded', 30)

    // The "Further action needed" section and "Go to reports" button are shown
    // on the success page, and the button links to the reports page.
    await checkBodyText(page, FURTHER_ACTION_HEADING, 10)
    await checkBodyText(page, FURTHER_ACTION_PARA_1, 5)
    await checkBodyText(page, FURTHER_ACTION_PARA_2, 5)
    await checkBodyText(page, FURTHER_ACTION_PARA_3, 5)
    expect((await uploadSummaryLogPage.goToReportsButton().count()) > 0).toBe(
      true
    )
    await uploadSummaryLogPage.goToReportsButton().click()
    // The caption names the material of the one registration this operator
    // holds, so it is that registration's reports and not just a reports page.
    const reportsPage = new ReportsPage(page)
    await reportsPage.expectListFor(currentYear())
    expect(await reportsPage.captionText()).toBe('Paper and board')

    await homePage.signOutLink().click()
    await expect(page).toHaveTitle(/Signed out/)
  })

  // The "no closed-period adjustments detected" control case used to live
  // here, but its org/upload setup was byte-for-byte identical to
  // summarylogs.exporter.e2e.js's happy-path test, just to assert the
  // banner/messaging is absent — merged there instead of paying for a second
  // identical org+login+upload cycle.
})
