import { AdminPage } from 'page-objects/admin/page'

class OrganisationOverviewPage extends AdminPage {
  async getRegistrationsTableData() {
    return this.readGovukTableRows('table.govuk-table', {
      registrationNumber: 1,
      registrationStatus: 2,
      processingType: 3,
      material: 4,
      site: 5
    })
  }

  async viewRegistrationLink(row) {
    await this.page
      .locator(
        `main table tbody tr:nth-child(${row}) td:nth-child(6) a:nth-of-type(1)`
      )
      .click()
  }

  async getDefraIdLinkText() {
    return this.page.locator('#main-content .govuk-summary-list').innerText()
  }

  get unlinkButton() {
    return this.page.getByRole('button', {
      name: 'Unlink organisation',
      exact: true
    })
  }

  async getNoLinkedOrganisationText() {
    return this.page
      .getByText('No linked organisation', { exact: true })
      .innerText()
  }

  async getNotificationBannerText() {
    return this.page.locator('.govuk-notification-banner').innerText()
  }
}

export { OrganisationOverviewPage }
