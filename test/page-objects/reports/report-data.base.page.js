import { Page } from 'page-objects/page'
import { expectPeriodYear } from './report-period.js'

export class ReportDataBasePage extends Page {
  async expectPeriodYear(year) {
    await expectPeriodYear(this.page, year)
  }

  async continue() {
    await this.page.locator('button[value="continue"]').click()
  }

  async saveAndComeBackLater() {
    await this.page.locator('button[value="save"]').click()
  }

  deleteReportLink() {
    return this.page.getByRole('link', { name: 'Delete report', exact: true })
  }

  async enterRevenue(value) {
    await this.page.locator('#prnRevenue').fill(value)
  }
}
