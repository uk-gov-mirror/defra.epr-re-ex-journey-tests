import { test, expect } from '@playwright/test'
import { HomePage } from 'page-objects/homepage.js'
import { ReportsPage } from 'page-objects/reports/reports.page.js'
import { ReportDetailPage } from 'page-objects/reports/report.detail.page.js'
import { TonnesRecycledPage } from '../page-objects/reports/tonnes.recycled.page.js'
import { TonnesNotRecycledPage } from '../page-objects/reports/tonnes.not.recycled.page.js'
import { ReprocessorPrnSummaryPage } from '../page-objects/reports/reprocessor.prn.summary.page.js'
import { FreePrnsPage } from '../page-objects/reports/free.prns.page.js'
import { ReportSupportingInformationPage } from 'page-objects/reports/report.supporting.information.page.js'
import { ReportCheckAnswersPage } from 'page-objects/reports/report.check.answers.page.js'
import { ReportStaleErrorPage } from 'page-objects/reports/report.stale.error.page.js'
import { checkBodyText } from '../support/checks.js'
import {
  createLinkedOrganisation,
  seedOverseasSites,
  updateMigratedOrganisation
} from '../support/seeding/organisation.js'
import {
  registrationStartYear,
  submitSummaryLogContent
} from '../support/seeding/summary-logs.js'
import {
  generateNumbers,
  generateRegNumber
} from '../support/reg-acc-number.js'
import { summaryLogContentNumbered } from '../support/spreadsheet/summarylogs-content-generator.js'
import { defraIdStub } from '../support/defra-id-stub.js'
import { expectActionRequiredStatus } from '../support/report-status.js'
import { createLinkAndLogin } from '../support/login-helper.js'
import { navigateToReports } from '../support/report-navigation.js'
import { currentYear } from '~/test/support/date.js'

const PL_FILE =
  'resources/sanity/reprocessorOutput_A26ER5000000001PL_R26ER5000000001PL.xlsx'

const REG_ONLY_FILE = 'resources/exporter-regonly.xlsx'

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

async function setupAccreditedReprocessor(
  page,
  material,
  regNumber,
  accNumber
) {
  const orgDetails = await createLinkedOrganisation([
    { material, wasteProcessingType: 'Reprocessor' }
  ])

  const migrationResponse = await updateMigratedOrganisation(orgDetails.refNo, [
    {
      reprocessingType: 'output',
      regNumber,
      accNumber,
      status: 'approved'
    }
  ])

  const user = await createLinkAndLogin(
    page,
    orgDetails.refNo,
    migrationResponse.email
  )

  return { orgDetails, migrationResponse, user }
}

async function createDraftReportFromCurrentReportsPage(page) {
  const reportsPage = new ReportsPage(page)
  const reportDetailPage = new ReportDetailPage(page)
  const reportSupportingInformationPage = new ReportSupportingInformationPage(
    page
  )
  const reportCheckAnswersPage = new ReportCheckAnswersPage(page)

  await reportsPage.selectActiveActionLink(1)
  await reportDetailPage.useThisData()
  await navigateReprocessorToSupportingInfo(page)
  await reportSupportingInformationPage.continue()
  await reportCheckAnswersPage.createReport()
  await checkBodyText(page, 'report created', 30)
  await page.locator('a', { hasText: 'Go to reports' }).click()
}

// Submitting via the dev endpoint instead of driving the upload wizard
// through the browser is safe here — staleness is a backend flag on a
// registration's summary-log version, keyed off the submission event itself,
// not off whether it happened via UI or API. The content is read back out
// and returned so a caller re-submitting the same fixture (to bump the
// version again) sends the identical content rather than re-reading the file.
async function setupAndCreateReport(
  page,
  material,
  regNumber,
  accNumber,
  filePath
) {
  const { orgDetails, migrationResponse, user } =
    await setupAccreditedReprocessor(page, material, regNumber, accNumber)

  const summaryLogContent = await summaryLogContentNumbered(filePath, {
    regNumber,
    accNumber
  })
  await submitSummaryLogContent(
    orgDetails.refNo,
    migrationResponse.registrationIds[0],
    defraIdStub.authHeader(user.userId),
    summaryLogContent,
    registrationStartYear()
  )
  await navigateToReports(page)

  await createDraftReportFromCurrentReportsPage(page)

  return { orgDetails, migrationResponse, user, summaryLogContent }
}

async function setupRegisteredOnlyExporter(page) {
  const regNumber = generateRegNumber({
    wasteProcessingType: 'exporter',
    materialSuffix: 'PA'
  })

  const organisationDetails = await createLinkedOrganisation([
    {
      material: 'Paper or board (R3)',
      wasteProcessingType: 'Exporter',
      withoutAccreditation: true
    }
  ])

  const migrationResponse = await updateMigratedOrganisation(
    organisationDetails.refNo,
    [
      {
        regNumber,
        status: 'approved',
        withoutAccreditation: true
      }
    ]
  )

  const user = await createLinkAndLogin(
    page,
    organisationDetails.refNo,
    migrationResponse.email
  )

  return { organisationDetails, migrationResponse, user, regNumber }
}

test.describe('Stale report @staleReport', () => {
  test('should redirect to the stale SL error page when navigating to a stale report, with working Return and Delete buttons and unable to submit a stale ready-to-submit report @staleReportSubmit @staleReportNavigation', async ({
    page
  }) => {
    const homePage = new HomePage(page)
    const reportsPage = new ReportsPage(page)
    const reportStaleErrorPage = new ReportStaleErrorPage(page)

    const { regNumber, accNumber } = generateNumbers({
      wasteProcessingType: 'reprocessor',
      materialSuffix: 'PL'
    })
    const { orgDetails, migrationResponse, user, summaryLogContent } =
      await setupAndCreateReport(
        page,
        'Plastic (R3)',
        regNumber,
        accNumber,
        PL_FILE
      )

    // Re-submit the same content via the dev endpoint to bump its version
    // and make the existing report stale.
    await submitSummaryLogContent(
      orgDetails.refNo,
      migrationResponse.registrationIds[0],
      defraIdStub.authHeader(user.userId),
      summaryLogContent,
      registrationStartYear()
    )

    // Navigating to the report now triggers the stale error page
    // This means we are unable to submit a stale ready-to-submit report
    await reportsPage.selectActiveActionLink(1)

    expect(await reportStaleErrorPage.headingText()).toBe(
      'Your summary log has changed'
    )

    // "Return to reports" navigates back to the reports list without deleting
    await reportStaleErrorPage.returnToReports().click()
    await reportsPage.expectListFor(currentYear())

    // Report is still present — navigating again shows the error page
    await reportsPage.selectActiveActionLink(1)
    expect(await reportStaleErrorPage.headingText()).toBe(
      'Your summary log has changed'
    )

    // "Delete and start again" deletes the report and returns to reports with
    // its un-started action-required status (Due, or Overdue if past due date)
    await reportStaleErrorPage.deleteAndStartAgain()
    await reportsPage.expectListFor(currentYear())
    await expectActionRequiredStatus(page, 1)

    await homePage.signOutLink().click()
    await expect(page).toHaveTitle(/Signed out/)
  })

  test('should redirect to the stale SL error page when navigating to a stale report (Registered Only), and unable to submit a stale in-progress report @staleReportSubmit @staleReportInProgress', async ({
    page
  }) => {
    const homePage = new HomePage(page)
    const reportsPage = new ReportsPage(page)
    const reportDetailPage = new ReportDetailPage(page)
    const tonnesRecycledPage = new TonnesRecycledPage(page)
    const reportStaleErrorPage = new ReportStaleErrorPage(page)

    const { organisationDetails, migrationResponse, user, regNumber } =
      await setupRegisteredOnlyExporter(page)

    await seedOverseasSites(
      organisationDetails.refNo,
      [0],
      [143, 297, 565, 893]
    )

    const regId = migrationResponse.registrationIds[0]
    const year = registrationStartYear()
    const authHeader = defraIdStub.authHeader(user.userId)

    const summaryLogContent = await summaryLogContentNumbered(REG_ONLY_FILE, {
      regNumber
    })
    await submitSummaryLogContent(
      organisationDetails.refNo,
      regId,
      authHeader,
      summaryLogContent,
      year
    )
    await navigateToReports(page)

    await reportsPage.selectActiveActionLink(1)
    await reportDetailPage.useThisData()
    await tonnesRecycledPage.saveAndComeBackLater()

    // Re-submit the same content via the dev endpoint to bump its version
    // and make the existing report stale.
    await submitSummaryLogContent(
      organisationDetails.refNo,
      regId,
      authHeader,
      summaryLogContent,
      year
    )

    // Navigating to the report now triggers the stale error page
    // This means we are unable to submit a stale in-progress report
    await reportsPage.selectActiveActionLink(1)

    expect(await reportStaleErrorPage.headingText()).toBe(
      'Your summary log has changed'
    )

    // "Delete and start again" deletes the report and returns to reports with
    // its un-started action-required status (Due, or Overdue if past due date)
    await reportStaleErrorPage.deleteAndStartAgain()
    await reportsPage.expectListFor(currentYear())
    await expectActionRequiredStatus(page, 1)

    await homePage.signOutLink().click()
    await expect(page).toHaveTitle(/Signed out/)
  })
})
