import { AdminPage } from 'page-objects/admin/page'

class RegistrationYearPage extends AdminPage {
  reportsTable() {
    return this.page.locator('#reports table')
  }

  async getReportsTableData() {
    // .count() below reads the DOM as-is with no auto-wait, so without this
    // the table can be read before it's rendered - seen as an intermittent
    // 0-row result in CI.
    await this.page
      .locator('#reports table')
      .waitFor({ state: 'visible', timeout: 10000 })

    const rows = this.page.locator('#reports table tbody tr')
    const count = await rows.count()
    const data = []

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i)
      const linkLocators = row.locator('td:nth-child(5) a')
      const linkCount = await linkLocators.count()
      const links = []
      for (let j = 0; j < linkCount; j++) {
        const link = linkLocators.nth(j)
        links.push({ text: await link.innerText() })
      }

      data.push({
        period: await row.locator('td:nth-child(1)').innerText(),
        submission: await row.locator('td:nth-child(2)').innerText(),
        due: await row.locator('td:nth-child(3)').innerText(),
        status: await row.locator('td:nth-child(4)').innerText(),
        actions: await row.locator('td:nth-child(5)').innerText(),
        links
      })
    }

    return data
  }

  viewORSLink() {
    return this.page
      .locator('.govuk-summary-list__row', {
        has: this.page.locator('dt', { hasText: 'Overseas sites' })
      })
      .getByRole('link', { name: 'View', exact: true })
  }

  /** @returns {import('@playwright/test').Locator} */
  prnActivityDownloadLink() {
    return this.page
      .locator('.govuk-summary-list__row', {
        has: this.page.locator('dt', { hasText: 'PRN activity' })
      })
      .getByRole('link', { name: 'Download', exact: true })
  }

  // The actions cell renders <a>View</a><br><a>Unsubmit</a>, so the nth-child
  // indices below count the <br>: View is child 1 and Unsubmit is child 3.
  async clickOnViewReportLink(row) {
    await this.page
      .locator(
        `#reports > table > tbody > tr:nth-child(${row}) > td:nth-child(5) > a:nth-child(1)`
      )
      .click()
  }

  async clickOnUnsubmitReportLink(row) {
    await this.page
      .locator(
        `#reports > table > tbody > tr:nth-child(${row}) > td:nth-child(5) > a:nth-child(3)`
      )
      .click()
  }

  async getSummaryLogsContent() {
    return this.page.locator('#summary-logs').innerText()
  }

  // The summary-logs table Actions cell (3rd column) renders
  // <a>View data</a><br><a>Download</a>; return both links so a test can
  // assert on the entry points offered for a log.
  async getSummaryLogActionLinks(row) {
    const cell = this.page.locator(
      `#summary-logs table tbody tr:nth-child(${row}) td:nth-child(3)`
    )
    await cell.waitFor({ state: 'visible', timeout: 10000 })

    const links = cell.locator('a')
    const count = await links.count()
    const data = []
    for (let i = 0; i < count; i++) {
      const link = links.nth(i)
      data.push({ text: await link.innerText() })
    }
    return data
  }

  async clickViewSummaryLogData(row) {
    await this.page
      .locator(`#summary-logs table tbody tr:nth-child(${row}) td:nth-child(3)`)
      .getByRole('link', { name: 'View data' })
      .click()
  }
}

export { RegistrationYearPage }
