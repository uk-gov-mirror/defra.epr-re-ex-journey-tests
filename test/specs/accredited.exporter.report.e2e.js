import { test, expect } from '@playwright/test'
import { HomePage } from 'page-objects/homepage.js'
import { DashboardPage } from '../page-objects/dashboard.page.js'
import { WasteRecordsPage } from '../page-objects/waste.records.page.js'
import { ReportsPage } from 'page-objects/reports/reports.page.js'
import { ReportDetailPage } from 'page-objects/reports/report.detail.page.js'
import { PrnSummaryPage } from '../page-objects/reports/prn.summary.page.js'
import { FreePernPage } from '../page-objects/reports/free.perns.page.js'
import { ReportSupportingInformationPage } from 'page-objects/reports/report.supporting.information.page.js'
import { ReportCheckAnswersPage } from 'page-objects/reports/report.check.answers.page.js'
import { ConfirmDeleteReportPage } from '../page-objects/confirm.delete.report.page.js'
import {
  createLinkedOrganisation,
  reportsLandingHasNoClosedPeriod,
  seedOverseasSites,
  updateMigratedOrganisation
} from '../support/seeding/organisation.js'
import { unsubmitReport } from '../support/seeding/reports.js'
import {
  registrationStartYear,
  submitSummaryLogContent
} from '../support/seeding/summary-logs.js'
import { generateNumbers } from '../support/reg-acc-number.js'
import { summaryLogContentNumbered } from '../support/spreadsheet/summarylogs-content-generator.js'
import { checkBodyText } from '../support/checks.js'
import { defraIdStub } from '../support/defra-id-stub.js'
import { createLinkAndLogin } from '../support/login-helper.js'
import { ConfirmationPage } from '../page-objects/reports/confirmation.page.js'
import {
  switchToNewTab,
  closeCurrentTabAndReturn
} from '../support/windowtabs.js'
import { expectActionRequiredStatus } from '../support/report-status.js'
import { MonthlyReportDraftDeclarationPage } from 'page-objects/reports/monthly.report.draft.declaration.page.js'
import { ReportSubmittedPage } from 'page-objects/reports/report.submitted.page.js'
import { currentYear } from '~/test/support/date.js'

test.describe('Accredited exporter report flow @accreditedExporter', () => {
  // These tests share one login session across the whole describe block
  // (each test builds on where the previous one left off), matching the
  // original WDIO behaviour of logging in once in `before` and reusing that
  // session across every `it`. Playwright isolates a fresh page/context per
  // test by default, so this uses the documented "share a single page
  // across a serial group" pattern instead of the per-test `page` fixture.
  test.describe.serial('accredited exporter with upload', () => {
    test.skip(
      reportsLandingHasNoClosedPeriod('monthly'),
      'the reports landing has no closed month yet this year'
    )

    let page
    let organisationDetails
    let migrationResponse

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage()

      const { regNumber, accNumber } = generateNumbers({
        wasteProcessingType: 'exporter',
        materialSuffix: 'PA'
      })

      organisationDetails = await createLinkedOrganisation([
        {
          material: 'Paper or board (R3)',
          wasteProcessingType: 'Exporter'
        }
      ])

      migrationResponse = await updateMigratedOrganisation(
        organisationDetails.refNo,
        [
          {
            regNumber,
            accNumber,
            status: 'approved'
          }
        ]
      )

      await seedOverseasSites(organisationDetails.refNo)

      const user = await createLinkAndLogin(
        page,
        organisationDetails.refNo,
        migrationResponse.email
      )

      // Seed the summary log via epr-backend's dev endpoint rather than a
      // real multipart upload: this journey is about the reports wizard,
      // not the upload itself, which the dedicated summary-log specs
      // already cover.
      const summaryLogContent = await summaryLogContentNumbered(
        'resources/sanity/exporter_A26EX5000000002PA_R26EX5000000002PA.xlsx',
        { regNumber, accNumber }
      )
      await submitSummaryLogContent(
        organisationDetails.refNo,
        migrationResponse.registrationIds[0],
        defraIdStub.authHeader(user.userId),
        summaryLogContent,
        registrationStartYear()
      )

      // Navigate to reports — all tests start from the Reports page
      const dashboardPage = new DashboardPage(page)
      const wasteRecordsPage = new WasteRecordsPage(page)
      await dashboardPage.selectTableLink(1, 1)
      await wasteRecordsPage.manageReportsLink().click()
    })

    test.afterAll(async () => {
      const homePage = new HomePage(page)
      await homePage.signOutLink().click()
      await expect(page).toHaveTitle(/Signed out/)
      await page.close()
    })

    test('should navigate back correctly through the accredited exporter flow @accreditedExporterBackLinks', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const prnSummaryPage = new PrnSummaryPage(page)
      const freePernPage = new FreePernPage(page)
      const reportSupportingInformationPage =
        new ReportSupportingInformationPage(page)
      const confirmDeleteReportPage = new ConfirmDeleteReportPage(page)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()

      // On prn-summary — back link goes to reports list
      await prnSummaryPage.backLink().click()
      await reportsPage.expectListFor(currentYear())

      // Re-enter the wizard — report is in_progress so the action link
      // routes straight to prn-summary
      await reportsPage.selectActiveActionLink(1)

      // Continue to free-perns
      await prnSummaryPage.enterRevenue('100')
      await prnSummaryPage.continue()

      // On free-perns — back link goes to prn-summary
      await freePernPage.backLink().click()
      const backToPrnSummary = await prnSummaryPage.headingText()
      expect(backToPrnSummary).toBeTruthy()

      // Continue through to supporting info
      await prnSummaryPage.enterRevenue('100')
      await prnSummaryPage.continue()
      await freePernPage.enterTonnage('0')
      await freePernPage.continue()

      // On supporting info — back link goes to free-perns
      await reportSupportingInformationPage.backLink().click()
      const backToFreePern = await freePernPage.headingText()
      expect(backToFreePern).toBeTruthy()

      // Clean up — delete report so next test starts fresh
      await freePernPage.deleteReportLink().click()
      await confirmDeleteReportPage.confirmDeletion()
    })

    test('should navigate to delete confirmation from PRN summary and free PERNs pages @accreditedExporterDelete', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const prnSummaryPage = new PrnSummaryPage(page)
      const freePernPage = new FreePernPage(page)
      const confirmDeleteReportPage = new ConfirmDeleteReportPage(page)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()

      // --- Delete from PRN summary page ---
      await prnSummaryPage.deleteReportLink().click()

      const deleteHeading = await confirmDeleteReportPage.headingText()
      expect(deleteHeading).toBe('Confirm deletion of this report')

      // Back link should return to prn-summary
      await confirmDeleteReportPage.backLink().click()
      const backToPrnSummary = await prnSummaryPage.headingText()
      expect(backToPrnSummary).toBeTruthy()

      // Confirm deletion
      await prnSummaryPage.deleteReportLink().click()
      await confirmDeleteReportPage.confirmDeletion()

      // Should be back on reports list with status reverted to Due
      await reportsPage.expectListFor(currentYear())

      await expectActionRequiredStatus(page, 1)

      // --- Create report again, navigate to free-perns, delete from there ---
      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()
      await prnSummaryPage.enterRevenue('100')
      await prnSummaryPage.continue()

      await freePernPage.deleteReportLink().click()

      const deleteHeading2 = await confirmDeleteReportPage.headingText()
      expect(deleteHeading2).toBe('Confirm deletion of this report')

      await confirmDeleteReportPage.confirmDeletion()

      // Should be back on reports list with status reverted to Due
      await reportsPage.expectListFor(currentYear())

      await expectActionRequiredStatus(page, 1)
    })

    test('should save and come back later from PRN summary and free PERNs pages @accreditedExporterSave', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const prnSummaryPage = new PrnSummaryPage(page)
      const freePernPage = new FreePernPage(page)
      const confirmDeleteReportPage = new ConfirmDeleteReportPage(page)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()

      // --- Save from PRN summary page ---
      await prnSummaryPage.enterRevenue('500')
      await prnSummaryPage.saveAndComeBackLater()

      // Should redirect back to reports list
      await reportsPage.expectListFor(currentYear())

      // Resume the report — Continue goes directly to prn-summary for accredited exporters
      await reportsPage.selectActiveActionLink(1)

      // Continue past prn-summary to free-perns
      await prnSummaryPage.enterRevenue('500')
      await prnSummaryPage.continue()

      // --- Save from free PERNs page ---
      await freePernPage.enterTonnage('0')
      await freePernPage.saveAndComeBackLater()

      // Should redirect back to reports list
      await reportsPage.expectListFor(currentYear())

      // Clean up — delete the report (Continue goes directly to prn-summary)
      await reportsPage.selectActiveActionLink(1)
      await prnSummaryPage.deleteReportLink().click()
      await confirmDeleteReportPage.confirmDeletion()
    })

    test('should complete the full accredited exporter report flow through to confirmation @accreditedExporterFullFlow', async () => {
      const reportsPage = new ReportsPage(page)
      const reportDetailPage = new ReportDetailPage(page)
      const prnSummaryPage = new PrnSummaryPage(page)
      const freePernPage = new FreePernPage(page)
      const reportSupportingInformationPage =
        new ReportSupportingInformationPage(page)
      const reportCheckAnswersPage = new ReportCheckAnswersPage(page)
      const confirmationPage = new ConfirmationPage(page)
      const monthlyReportDraftDeclarationPage =
        new MonthlyReportDraftDeclarationPage(page)
      const reportSubmittedPage = new ReportSubmittedPage(page)

      await reportsPage.selectActiveActionLink(1)
      await reportDetailPage.useThisData()

      // --- PRN Summary page ---
      const prnSummaryHeading = await prnSummaryPage.headingText()
      expect(prnSummaryHeading).toBeTruthy()

      // Enter revenue
      await prnSummaryPage.enterRevenue('1500.50')
      await prnSummaryPage.continue()

      // --- Free PERNs page ---
      const freePernHeading = await freePernPage.headingText()
      expect(freePernHeading).toBeTruthy()

      // Enter free PERN tonnage (must be <= issued tonnage)
      await freePernPage.enterTonnage('0')
      await freePernPage.continue()

      // --- Supporting information page ---
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

      // Verify PRN revenue persists to CYA
      await checkBodyText(page, '1,500.50', 10)

      // Submit the report
      await reportCheckAnswersPage.createReport()

      // Verify confirmation page
      await checkBodyText(page, 'report created', 30)

      // --- View draft report in new tab ---
      await confirmationPage.viewDraftReport().click()
      let newTab = await switchToNewTab(page)

      // Verify draft report page content
      await checkBodyText(newTab, 'Draft report for', 10)
      await checkBodyText(newTab, 'Ready to submit', 10)
      await checkBodyText(newTab, 'Created by:', 10)
      await checkBodyText(newTab, 'Created on:', 10)
      await checkBodyText(newTab, 'Packaging waste received for exporting', 10)
      await checkBodyText(newTab, 'Packaging waste exported for recycling', 10)
      await checkBodyText(newTab, 'Packaging waste sent on', 10)
      await checkBodyText(newTab, 'Supporting information', 10)

      // Close draft tab and return to confirmation page
      await closeCurrentTabAndReturn(newTab)

      // Report is now ready_to_submit. Navigating back to check-answers
      // should redirect to the reports list, not show the form again.
      await page.goBack()

      await reportsPage.expectListFor(currentYear())

      // Refresh to see the status change
      await page.reload()

      const readyStatusBadge = await reportsPage.getActiveStatusBadge(1)
      const readyStatusColour = await reportsPage.getActiveStatusColour(1)

      expect(readyStatusBadge).toBe('Ready to submit')
      expect(readyStatusColour).toBe('blue')

      await reportsPage.selectActiveActionLink(1)

      // Confirm and submit report
      await monthlyReportDraftDeclarationPage.confirmAndSubmit()

      const confirmationText = await reportSubmittedPage.confirmationText()
      expect(confirmationText).toContain('report submitted to regulator')

      await reportSubmittedPage.viewReportLink().click()
      newTab = await switchToNewTab(page)

      await checkBodyText(newTab, 'Report for', 10)
      await checkBodyText(newTab, 'Submitted', 10)
      await checkBodyText(newTab, 'Submitted by:', 10)
      await checkBodyText(newTab, 'Submitted on:', 10)
      await checkBodyText(newTab, 'Packaging waste received for exporting', 10)
      await checkBodyText(newTab, 'Packaging waste exported for recycling', 10)
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
        organisationDetails.refNo,
        migrationResponse.registrationIds[0],
        registrationStartYear(),
        'monthly',
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
