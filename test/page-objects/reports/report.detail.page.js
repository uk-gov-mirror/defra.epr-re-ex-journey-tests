import { Page } from 'page-objects/page'
import { expectPeriodYear } from './report-period.js'
import { expect } from '@playwright/test'
import { UploadSummaryLogPage } from '../upload.summary.log.page.js'
import { ReportsPage } from './reports.page.js'
import { currentYear } from '~/test/support/date.js'

class ReportDetailPage extends Page {
  async expectPeriodYear(year) {
    await expectPeriodYear(this.page, year)
  }

  open(orgId, regId, year, cadence, period, submissionNumber = 1) {
    return this.page.goto(
      `/organisations/${orgId}/registrations/${regId}/reports/${year}/${cadence}/${period}/submissions/${submissionNumber}`
    )
  }

  async useThisData() {
    await this.clickButton('Use this data')
  }

  // The detail page renders each section total as a `govuk-caption-l` label
  // immediately followed by a `govuk-heading-l` value (e.g. "26.60"). There is
  // no test id, so we key off the caption text and take its sibling value.
  async #sectionTotalByCaption(caption) {
    return this.page
      .locator(
        `//p[contains(@class, "govuk-caption-l")][normalize-space()="${caption}"]/following-sibling::p[1]`
      )
      .innerText()
  }

  async totalTonnageExported() {
    return this.#sectionTotalByCaption('Total tonnage exported')
  }

  async uploadNewSummaryLog() {
    await this.page
      .getByRole('button', { name: 'Upload new summary log', exact: true })
      .click()
  }

  async cancelAndReturnToReports() {
    await this.page
      .getByRole('link', {
        name: 'Cancel and return to reports',
        exact: true
      })
      .click()
  }

  // expect(locator) defaults to a 5s timeout, well under this suite's usual
  // navigation margin (the value-form reads these replaced waited on the
  // much longer test timeout via innerText()'s actionability check) - so
  // each heading assertion here gets the same 10s margin used elsewhere in
  // this codebase for a heading that settles after navigation (e.g.
  // CreatePRNPage.headingText()'s expect.poll).
  async verifyDetailPageButtons() {
    await expect(this.heading()).toContainText('Your summary log data', {
      timeout: 10000
    })

    await this.uploadNewSummaryLog()
    const uploadSummaryLogPage = new UploadSummaryLogPage(this.page)
    await expect(uploadSummaryLogPage.heading()).toContainText(
      'Upload your summary log',
      { timeout: 10000 }
    )

    await this.page.goBack()
    await this.cancelAndReturnToReports()
    const reportsPage = new ReportsPage(this.page)
    await reportsPage.expectListFor(currentYear())
  }
}

export { ReportDetailPage }
