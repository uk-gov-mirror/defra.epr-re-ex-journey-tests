import { expect } from '@playwright/test'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

// A report page names its period as "Quarter 1 2026", "Quarter 1, 2026",
// "January 2026" or "January, 2026", depending on the page.
export const expectPeriodYear = (page, year) =>
  expect
    .poll(() => page.locator('main').innerText(), { timeout: 10000 })
    .toMatch(new RegExp(`(Quarter [1-4]|${MONTHS.join('|')}),? ${year}`))
