import { Page } from 'page-objects/page'
import { expectPeriodYear } from './report-period.js'

class ReportCheckAnswersPage extends Page {
  async expectPeriodYear(year) {
    await expectPeriodYear(this.page, year)
  }

  async createReport() {
    await this.clickButton('Create draft report')
  }

  async createReportAndCheckDoubleClickPrevented() {
    await this.clickButtonCheckingDoubleClickPrevented('Create draft report')
  }

  deleteAndStartAgainLink() {
    return this.page.getByRole('button', {
      name: 'Delete and start again',
      exact: true
    })
  }
}

export { ReportCheckAnswersPage }
