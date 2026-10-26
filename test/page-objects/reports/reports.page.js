import { expect } from '@playwright/test'
import { Page } from 'page-objects/page'

const ACTIVE_HEADING = 'Action required'
const SUBMITTED_HEADING = 'Submitted'

// Scope to the table whose nearest preceding h3 is this heading. The extra
// predicate matters when a section is empty: the landing renders no table for
// it (just a message), so a plain following-sibling would otherwise resolve to
// the next section's table (e.g. an empty Action required picking up Submitted).
const tableAfterHeadingXPath = (heading) =>
  `//h3[normalize-space()='${heading}']/following-sibling::table[contains(@class,'govuk-table')][preceding-sibling::h3[1][normalize-space()='${heading}']][1]`

const rowXPath = (tableXPath, rowIndex) =>
  `${tableXPath}//tbody/tr[${rowIndex}]`

// The action-link helpers key off the first govuk-link in the row, which
// assumes each row exposes exactly one action anchor (the period cell is plain
// text). If a row ever gains a second link, target the action column explicitly
// instead.
const selectActionLink = async (page, rowIndex, tableXPath) => {
  await page
    .locator(
      `${rowXPath(tableXPath, rowIndex)}//a[contains(@class,'govuk-link')]`
    )
    .click()
}

// The action anchor carries a govuk-visually-hidden period suffix for screen
// readers (e.g. "Review and create draft" + "Quarter 1, 2026"), so match on the
// visible label as a substring rather than an exact string.
const actionLinkByTextXPath = (rowIndex, tableXPath, label) =>
  `${rowXPath(tableXPath, rowIndex)}//a[contains(@class,'govuk-link')][contains(normalize-space(), '${label}')]`

const selectActionLinkByText = async (page, rowIndex, tableXPath, label) => {
  await page.locator(actionLinkByTextXPath(rowIndex, tableXPath, label)).click()
}

const expectActionLink = async (page, rowIndex, tableXPath, label) => {
  await page
    .locator(actionLinkByTextXPath(rowIndex, tableXPath, label))
    .waitFor({ state: 'attached', timeout: 5000 })
}

const getStatusBadgeLocator = (page, rowIndex, tableXPath) =>
  page.locator(
    `${rowXPath(tableXPath, rowIndex)}//*[contains(@class,'govuk-tag')]`
  )

const getStatusBadge = async (page, rowIndex, tableXPath) => {
  return getStatusBadgeLocator(page, rowIndex, tableXPath).innerText()
}

const getStatusColour = async (page, rowIndex, tableXPath) => {
  const classAttr =
    (await getStatusBadgeLocator(page, rowIndex, tableXPath).getAttribute(
      'class'
    )) ?? ''
  const match = classAttr.match(/govuk-tag--(\w+)/)
  return match ? match[1] : 'blue'
}

class ReportsPage extends Page {
  #activeTableXPath = tableAfterHeadingXPath(ACTIVE_HEADING)
  #submittedTableXPath = tableAfterHeadingXPath(SUBMITTED_HEADING)

  // Overrides the base Page's heading()/headingText(): this page's own h1
  // renders as govuk-heading-l, not the govuk-heading-xl every other page in
  // the suite uses.
  heading() {
    return this.page.locator('h1.govuk-heading-l')
  }

  async headingText() {
    return this.heading().innerText()
  }

  async expectListFor(year) {
    await expect(this.heading()).toContainText(`Manage reports (${year})`, {
      timeout: 10000
    })
    await expect(this.page).toHaveURL(new RegExp(`/reports/${year}$`))
  }

  captionText() {
    return this.heading().locator('.govuk-caption-l').innerText()
  }

  async selectActiveActionLink(rowIndex) {
    await selectActionLink(this.page, rowIndex, this.#activeTableXPath)
  }

  async selectSubmittedActionLink(rowIndex) {
    await selectActionLink(this.page, rowIndex, this.#submittedTableXPath)
  }

  async selectActiveActionLinkByText(rowIndex, label) {
    await selectActionLinkByText(
      this.page,
      rowIndex,
      this.#activeTableXPath,
      label
    )
  }

  async getActivePeriodLabel(rowIndex) {
    return this.page
      .locator(`${rowXPath(this.#activeTableXPath, rowIndex)}//td[1]`)
      .innerText()
  }

  async expectActiveActionLink(rowIndex, label) {
    await expectActionLink(this.page, rowIndex, this.#activeTableXPath, label)
  }

  async expectSubmittedActionLink(rowIndex, label) {
    await expectActionLink(
      this.page,
      rowIndex,
      this.#submittedTableXPath,
      label
    )
  }

  // The Action required section renders an empty message instead of a table
  // when no period needs action, so a missing table is the empty state.
  async activeTableText() {
    const table = this.page.locator(this.#activeTableXPath)
    if ((await table.count()) === 0) {
      return ''
    }
    return table.innerText()
  }

  async getActiveStatusBadge(rowIndex) {
    return getStatusBadge(this.page, rowIndex, this.#activeTableXPath)
  }

  async getSubmittedStatusBadge(rowIndex) {
    return getStatusBadge(this.page, rowIndex, this.#submittedTableXPath)
  }

  async getActiveStatusColour(rowIndex) {
    return getStatusColour(this.page, rowIndex, this.#activeTableXPath)
  }

  async getSubmittedStatusColour(rowIndex) {
    return getStatusColour(this.page, rowIndex, this.#submittedTableXPath)
  }

  async getActiveNumberOfRows() {
    return this.page.locator(this.#activeTableXPath + '//tbody/tr').count()
  }

  // Every action anchor the Action required section offers. A period in that
  // section has no report to read, so the action a row carries is always a
  // write one - and a session that cannot write is offered none of them.
  async getActiveNumberOfActionLinks() {
    return this.page
      .locator(
        `${this.#activeTableXPath}//tbody//a[contains(@class,'govuk-link')]`
      )
      .count()
  }
}

export { ReportsPage }
