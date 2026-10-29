import { AdminPage } from 'page-objects/admin/page'

class RegistrationOverviewPage extends AdminPage {
  async getYearsTableData() {
    // .count() below reads the DOM as-is with no auto-wait, so wait for the
    // table first.
    await this.page
      .locator('#years table')
      .waitFor({ state: 'visible', timeout: 10000 })

    const rows = this.page.locator('#years table tbody tr')
    const count = await rows.count()
    const data = []

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i)
      data.push({
        year: await row.locator('td:nth-child(1)').innerText(),
        registrationStatus: await row.locator('td:nth-child(2)').innerText(),
        accreditationStatus: await row.locator('td:nth-child(3)').innerText(),
        accreditationNumber: await row.locator('td:nth-child(4)').innerText()
      })
    }

    return data
  }

  // The View link's accessible name carries the year in visually hidden text.
  async viewYear(year) {
    await this.page
      .locator('#years')
      .getByRole('link', { name: `View ${year}`, exact: true })
      .click()
  }

  async viewLatestYear() {
    await this.page
      .locator('#years table tbody tr')
      .first()
      .getByRole('link', { name: /^View \d{4}$/ })
      .click()
  }

  async viewLatestAccreditedYear() {
    await this.page
      .locator('#years table tbody tr')
      .filter({ hasNotText: 'Not accredited' })
      .first()
      .getByRole('link', { name: /^View \d{4}$/ })
      .click()
  }
}

export { RegistrationOverviewPage }
