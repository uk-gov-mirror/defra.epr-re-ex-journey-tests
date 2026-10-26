import { test, expect } from '@playwright/test'
import { HomePage } from 'page-objects/homepage.js'
import { DashboardPage } from 'page-objects/dashboard.page.js'
import { ReportsPage } from 'page-objects/reports/reports.page.js'
import { ReportDetailPage } from 'page-objects/reports/report.detail.page.js'
import { TonnesRecycledPage } from '../page-objects/reports/tonnes.recycled.page.js'
import { TonnesNotRecycledPage } from '../page-objects/reports/tonnes.not.recycled.page.js'
import { ReportSupportingInformationPage } from 'page-objects/reports/report.supporting.information.page.js'
import { ReportCheckAnswersPage } from 'page-objects/reports/report.check.answers.page.js'
import { ConfirmDeleteReportPage } from '../page-objects/confirm.delete.report.page.js'
import { MonthlyReportDraftDeclarationPage } from 'page-objects/reports/monthly.report.draft.declaration.page.js'
import {
  createLinkedOrganisation,
  reportsLandingHasNoClosedPeriod,
  updateMigratedOrganisation
} from '../support/seeding/organisation.js'
import { unsubmitReport } from '../support/seeding/reports.js'
import {
  registrationStartYear,
  submitSummaryLogContent
} from '../support/seeding/summary-logs.js'
import { generateRegNumber } from '../support/reg-acc-number.js'
import { summaryLogContentNumbered } from '../support/spreadsheet/summarylogs-content-generator.js'
import { createLinkAndLogin } from '../support/login-helper.js'
import { defraIdStub } from '../support/defra-id-stub.js'
import { navigateToReports } from '../support/report-navigation.js'
import {
  checkBodyText,
  checkBodyTextDoesNotInclude
} from '../support/checks.js'
import { ConfirmationPage } from 'page-objects/reports/confirmation.page.js'
import {
  closeCurrentTabAndReturn,
  switchToNewTab
} from '../support/windowtabs.js'
import { ReportSubmittedPage } from 'page-objects/reports/report.submitted.page.js'
import { currentYear } from '~/test/support/date.js'

// Submitted via epr-backend's dev endpoint rather than driving the upload
// UI: these journeys are about the reports wizard, not the upload itself,
// which the dedicated summary-log specs already cover.
/** @param {string} regNumber */
async function uploadAndNavigateToReports(
  page,
  organisationDetails,
  migrationResponse,
  user,
  regNumber
) {
  const summaryLogContent = await summaryLogContentNumbered(
    'resources/reprocessor-output-regonly.xlsx',
    { regNumber }
  )
  await submitSummaryLogContent(
    organisationDetails.refNo,
    migrationResponse.registrationIds[0],
    defraIdStub.authHeader(user.userId),
    summaryLogContent,
    registrationStartYear()
  )
  await navigateToReports(page)
}

async function setupRegisteredOnlyReprocessor(page) {
  const regNumber = generateRegNumber({
    wasteProcessingType: 'reprocessor',
    materialSuffix: 'PA'
  })

  const organisationDetails = await createLinkedOrganisation([
    {
      material: 'Paper or board (R3)',
      wasteProcessingType: 'Reprocessor',
      withoutAccreditation: true
    }
  ])

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

  const user = await createLinkAndLogin(
    page,
    organisationDetails.refNo,
    migrationResponse.email
  )

  return { organisationDetails, migrationResponse, user, regNumber }
}

test.describe('Registered-only reprocessor report flow @registeredOnlyReprocessor', () => {
  test.skip(
    reportsLandingHasNoClosedPeriod('quarterly'),
    'the reports landing has no closed quarter yet this year'
  )

  // These 2 tests share one continuous login session/report, the same
  // pattern used in accredited.reprocessor.report.e2e.js - serial mode + a
  // manually-created page shares setup instead of re-paying org creation,
  // login, and summary log upload twice. BackLinks cleans its report back
  // to "Due" so FullFlow (last, since it ends in a submitted/unsubmitted
  // state) starts fresh.
  test.describe.serial('registered-only reprocessor with upload', () => {
    /** @type {import('@playwright/test').Page} */
    let page
    let setupResponse

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage()
      setupResponse = await setupRegisteredOnlyReprocessor(page)
      await uploadAndNavigateToReports(
        page,
        setupResponse.organisationDetails,
        setupResponse.migrationResponse,
        setupResponse.user,
        setupResponse.regNumber
      )
    })

    test.afterAll(async () => {
      const homePage = new HomePage(page)
      await homePage.signOutLink().click()
      await expect(page).toHaveTitle(/Signed out/)
      await page.close()
    })

    test('should navigate back correctly through the registered-only reprocessor flow @registeredOnlyReprocessorBackLinks', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const tonnesRecycledPage = new TonnesRecycledPage(page)
      const tonnesNotRecycledPage = new TonnesNotRecycledPage(page)
      const reportSupportingInformationPage =
        new ReportSupportingInformationPage(page)
      const confirmDeleteReportPage = new ConfirmDeleteReportPage(page)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()

      // On tonnes-recycled — back link goes to reports list
      await tonnesRecycledPage.backLink().click()
      await reportsPage.expectListFor(currentYear())

      // Re-enter the wizard — report is in_progress so the action link
      // routes straight to tonnes-recycled
      await reportsPage.selectActiveActionLink(1)

      // Continue to tonnes-not-recycled
      await tonnesRecycledPage.enterTonnage('12.50')
      await tonnesRecycledPage.continue()

      // On tonnes-not-recycled — back link goes to tonnes-recycled
      await tonnesNotRecycledPage.backLink().click()
      const backToTonnesRecycled = await tonnesRecycledPage.headingText()
      expect(backToTonnesRecycled).toBeTruthy()

      // Continue to supporting-information (skips PRN pages)
      await tonnesRecycledPage.enterTonnage('12.50')
      await tonnesRecycledPage.continue()
      await tonnesNotRecycledPage.enterTonnage('7.50')
      await tonnesNotRecycledPage.continue()

      // On supporting-information — back link goes to tonnes-not-recycled (not free-prns)
      await reportSupportingInformationPage.backLink().click()
      const backToTonnesNotRecycled = await tonnesNotRecycledPage.headingText()
      expect(backToTonnesNotRecycled).toBeTruthy()

      // Clean up — leave the period "Due" for the next test
      await tonnesNotRecycledPage.deleteReportLink().click()
      await confirmDeleteReportPage.confirmDeletion()
    })

    test('should complete the full registered-only reprocessor report flow through to confirmation @registeredOnlyReprocessorFullFlow', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const tonnesRecycledPage = new TonnesRecycledPage(page)
      const tonnesNotRecycledPage = new TonnesNotRecycledPage(page)
      const reportSupportingInformationPage =
        new ReportSupportingInformationPage(page)
      const reportCheckAnswersPage = new ReportCheckAnswersPage(page)
      const confirmationPage = new ConfirmationPage(page)
      const monthlyReportDraftDeclarationPage =
        new MonthlyReportDraftDeclarationPage(page)
      const reportSubmittedPage = new ReportSubmittedPage(page)

      // Start the report — verify detail page buttons before proceeding
      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.verifyDetailPageButtons()

      await reportsPage.selectActiveActionLink(1)
      await checkBodyText(page, setupResponse.regNumber, 10)
      await reportDetailPage.useThisData()

      // --- Tonnes recycled page ---
      const tonnesRecycledHeading = await tonnesRecycledPage.headingText()
      expect(tonnesRecycledHeading).toBeTruthy()

      await tonnesRecycledPage.enterTonnage('12.50')
      await tonnesRecycledPage.continue()

      // --- Tonnes not recycled page ---
      const tonnesNotRecycledHeading = await tonnesNotRecycledPage.headingText()
      expect(tonnesNotRecycledHeading).toBeTruthy()

      await tonnesNotRecycledPage.enterTonnage('7.50')
      await tonnesNotRecycledPage.continue()

      // --- Supporting information page (no PRN pages for registered-only) ---
      const supportingInfoHeading =
        await reportSupportingInformationPage.headingText()
      expect(supportingInfoHeading).toBe(
        'Add supporting information for your regulator (optional)'
      )
      await reportSupportingInformationPage.continue()

      // --- Check your answers page ---
      const checkHeading = await reportCheckAnswersPage.headingText()
      expect(checkHeading).toBe(
        'Check your answers before you create this draft report'
      )
      await reportCheckAnswersPage.expectPeriodYear(currentYear())

      // Verify recycling activity values displayed (rendered without formatTonnage, so no trailing zero)
      await checkBodyText(page, '12.5', 10)
      await checkBodyText(page, '7.5', 10)

      // Verify NO PRN section present
      await checkBodyTextDoesNotInclude(page, 'PRN revenue', 5)
      await checkBodyTextDoesNotInclude(page, 'Free PRNs', 5)
      await checkBodyTextDoesNotInclude(page, 'Average price per tonne', 5)

      // Submit the report
      await reportCheckAnswersPage.createReport()

      // Verify confirmation page
      await checkBodyText(page, 'report created', 30)

      // --- View draft report in new tab ---
      await confirmationPage.viewDraftReport().click()
      let newTab = await switchToNewTab(page)

      // Verify draft report page content
      await checkBodyText(newTab, 'Draft report for Quarter', 10)
      await checkBodyText(newTab, 'Ready to submit', 10)
      await checkBodyText(newTab, 'Created by:', 10)
      await checkBodyText(newTab, 'Created on:', 10)
      await checkBodyText(newTab, 'Site', 10)
      await checkBodyText(
        newTab,
        'Packaging waste received for reprocessing',
        10
      )
      await checkBodyText(newTab, 'Packaging waste recycling', 10)
      await checkBodyText(newTab, 'Packaging waste sent on', 10)
      await checkBodyText(newTab, 'Supporting information', 10)

      // Close draft tab and return to confirmation page
      await closeCurrentTabAndReturn(newTab)

      await confirmationPage.returnToHome().click()
      await new DashboardPage(page).expectYear(currentYear())
      await page.goBack()

      await confirmationPage.goToReports().click()
      await reportsPage.expectListFor(currentYear())
      await reportsPage.selectActiveActionLink(1)

      // Confirm and submit report
      await monthlyReportDraftDeclarationPage.confirmAndSubmit()

      const confirmationText = await reportSubmittedPage.confirmationText()
      expect(confirmationText).toContain('report submitted to regulator')

      await reportSubmittedPage.viewReportLink().click()
      newTab = await switchToNewTab(page)

      await checkBodyText(newTab, 'Report for Quarter', 10)
      await checkBodyText(newTab, 'Submitted', 10)
      await checkBodyText(newTab, 'Submitted by:', 10)
      await checkBodyText(newTab, 'Submitted on:', 10)
      await checkBodyText(newTab, 'Site', 10)
      await checkBodyText(
        newTab,
        'Packaging waste received for reprocessing',
        10
      )
      await checkBodyText(newTab, 'Packaging waste recycling', 10)
      await checkBodyText(newTab, 'Packaging waste sent on', 10)
      await checkBodyText(newTab, 'Supporting information', 10)

      // Close report tab and return to submission confirmation page
      await closeCurrentTabAndReturn(newTab)

      await reportSubmittedPage.returnToReportsLink().click()
      await reportsPage.expectListFor(currentYear())

      const submittedBadge = await reportsPage.getSubmittedStatusBadge(1)
      const submittedColour = await reportsPage.getSubmittedStatusColour(1)

      expect(submittedBadge).toBe('Submitted')
      expect(submittedColour).toBe('green')

      // Now we unsubmit the report via epr-backend to see the effects on the frontend
      await unsubmitReport(
        setupResponse.organisationDetails.refNo,
        setupResponse.migrationResponse.registrationIds[0],
        registrationStartYear(),
        'quarterly',
        1,
        1
      )

      // Refresh to see the status change
      await page.reload()

      const unsubmittedBadge = await reportsPage.getActiveStatusBadge(1)
      const unsubmittedColour = await reportsPage.getActiveStatusColour(1)

      expect(unsubmittedBadge).toBe('Ready to submit')
      expect(unsubmittedColour).toBe('blue')
    })
  })
})
