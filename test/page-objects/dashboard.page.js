import { expect } from '@playwright/test'
import { Page } from 'page-objects/page'

class DashboardPage extends Page {
  open(orgId) {
    return this.page.goto(`/organisations/${orgId}`)
  }

  async selectLink(index) {
    await this.page
      .locator(
        '#main-content table.govuk-table tr:nth-child(' +
          index +
          ') a.govuk-link'
      )
      .click()
  }

  async selectTableLink(tableIndex, index) {
    await this.page
      .locator(
        '#main-content table.govuk-table:nth-of-type(' +
          tableIndex +
          ') tr:nth-child(' +
          index +
          ') a.govuk-link'
      )
      .click()
  }

  async availableWasteBalance(index) {
    return this.page
      .locator(
        '#main-content table.govuk-table tr:nth-child(' +
          index +
          ') > td.govuk-table__cell.govuk-table__cell--numeric'
      )
      .innerText()
  }

  yearHeading() {
    return this.page.locator('#main-content span.govuk-heading-m', {
      hasText: /^This is \d{4} data$/
    })
  }

  async expectYear(year) {
    await expect(this.yearHeading()).toHaveText(`This is ${year} data`, {
      timeout: 10000
    })
    await expect(this.page).toHaveURL(
      new RegExp(`/organisations/\\d+/${year}(/exporting)?$`)
    )
  }

  chooseDifferentYearLink() {
    return this.page.getByRole('link', {
      name: 'Choose a different year',
      exact: true
    })
  }

  // This ".govuk-tabs" block renders without data-module="govuk-tabs" (see
  // organisations/index.njk), so the GOV.UK tabs JS never enhances it and the
  // "Exporting"/"Reprocessing" items stay plain links, not role="tab".
  exportingTabLink() {
    return this.page.getByRole('link', { name: 'Exporting', exact: true })
  }

  async getTableCell(tableIndex, rowIndex, cellIndex) {
    return this.page
      .locator(
        `#main-content table.govuk-table:nth-of-type(${tableIndex}) tr:nth-child(${rowIndex}) > td:nth-child(${cellIndex})`
      )
      .innerText()
  }

  async getMaterial(tableIndex, rowIndex) {
    return this.getTableCell(tableIndex, rowIndex, 1)
  }

  async getRegistrationStatus(tableIndex, rowIndex) {
    return this.getTableCell(tableIndex, rowIndex, 2)
  }

  async getAccreditationStatus(tableIndex, rowIndex) {
    return this.getTableCell(tableIndex, rowIndex, 3)
  }

  async getTableRow(tableIndex, rowIndex) {
    return this.readGovukTableRow(
      `#main-content table.govuk-table:nth-of-type(${tableIndex})`,
      rowIndex
    )
  }
}

export { DashboardPage }
