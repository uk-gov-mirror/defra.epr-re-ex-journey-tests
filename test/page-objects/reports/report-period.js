import { expect } from '@playwright/test'
import { MONTHS_OF_THE_YEAR } from '~/test/support/date.js'

// A report page names its period as "Quarter 1 2026", "Quarter 1, 2026",
// "January 2026" or "January, 2026", depending on the page.
export const expectPeriodYear = (page, year) =>
  expect
    .poll(() => page.locator('main').innerText(), { timeout: 10000 })
    .toMatch(
      new RegExp(`(Quarter [1-4]|${MONTHS_OF_THE_YEAR.join('|')}),? ${year}`)
    )
