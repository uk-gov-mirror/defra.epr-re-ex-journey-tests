import { test, expect } from '@playwright/test'

import { MarketInsightsPage } from 'page-objects/regulator/market-insights.page'
import { MarketInsightsOutstandingReturnsPage } from 'page-objects/regulator/market-insights-outstanding-returns.page'
import { MarketInsightsReprocessorExporterPage } from 'page-objects/regulator/market-insights-reprocessor-exporter.page'
import {
  MarketInsightsWasteBalancePage,
  WASTE_BALANCE_HEADINGS
} from 'page-objects/regulator/market-insights-waste-balance.page'
import { RegulatorHomePage } from 'page-objects/regulator/home.page'
import { RegulatorLoginPage } from 'page-objects/regulator/login.page'
import {
  assertNoSeriousOrCriticalViolations,
  scanPageForAccessibilityViolations,
  tagAccessibilityTest
} from '../../support/accessibility.js'
import { seedAwaitingPrnAndSubmittedReport } from '../../support/seeding/regulator-read.js'
import { MONTHS_OF_THE_YEAR } from '../../support/date.js'

// An amount as every page states one: two decimal places, and thousands
// grouped.
const AMOUNT = String.raw`-?\d{1,3}(,\d{3})*\.\d{2}`

// A tonnage as the waste balance states one.
const TONNAGE = new RegExp(`^${AMOUNT}$`)

// A figure as the reprocessor and exporter tables state one, which is a
// tonnage or a sum of money, or what the Grand Total row prints where its
// average price would be: the dash, and the text a screen reader is given
// instead, because the publication calculates none for it. The hidden text
// is a block of its own, so the browser reads a line break between them.
const FIGURE = new RegExp(
  String.raw`^(£?${AMOUNT}|-\s+No average price is calculated)$`
)

// A report count as the page states one: how many were submitted of how many
// were expected.
const REPORT_COUNT = /^\d+ of \d+$/

// A count of outstanding reports as the page states one: a whole number, and a
// zero where nothing is outstanding rather than a blank.
const OUTSTANDING_COUNT = /^\d+$/

// The tonnage bands every outstanding reports table states down its side, in
// the order the published tab lists them. Sorting them by their words would
// put the largest at the top, so the order is asserted rather than the set.
const TONNAGE_BANDS = [
  'Up to 500 tonnes',
  'Up to 5,000 tonnes',
  'Up to 10,000 tonnes',
  'Over 10,000 tonnes'
]

// The nations whose figures get a page of their own, in the order the listing
// offers them.
const NATIONS = ['England', 'Wales', 'Scotland', 'Northern Ireland']

// The period the figures cover, as the heading states it above the page's own
// name, with the reporting year on the end.
const PERIOD = /^[A-Z][a-z]+( to [A-Z][a-z]+)? (\d{4})$/

// When a set of figures was taken, as the page stamps it.
const DATA_TAKEN_AT = /^Data taken at .+ on .+$/

/**
 * The value a stated tonnage carries. The grouping is there to be read rather
 * than parsed, so it comes out before the number does.
 * @param {string} figure
 * @returns {number}
 */
const asNumber = (figure) => Number(figure.replaceAll(',', ''))

test.describe('A regulator reading market insights @regulator', () => {
  test('follows the link out of the regulator area and reads each set of published figures @regulatorMarketInsights', async ({
    page
  }) => {
    const homePage = new RegulatorHomePage(page)
    const loginPage = new RegulatorLoginPage(page)
    const marketInsightsPage = new MarketInsightsPage(page)
    const wasteBalancePage = new MarketInsightsWasteBalancePage(page)
    // One reader for both figures pages. Nothing binds an instance to an
    // address, so it reads whichever of them the journey is standing on.
    const figuresPage = new MarketInsightsReprocessorExporterPage(page)
    const outstandingReturnsPage = new MarketInsightsOutstandingReturnsPage(
      page
    )
    const violations = []

    await tagAccessibilityTest('Regulator Market insights pages')

    // The figures are the UK's rather than one operator's, so the seed is not
    // asserted back by name. What it is here for is tonnage: a summary log
    // submitted against an approved accreditation is what credits the waste
    // balance, and without one the page has a period but no table to show for
    // it.
    await seedAwaitingPrnAndSubmittedReport()

    await loginPage.loginAsRegulator()

    expect(await homePage.getHeadingText()).toBe('All organisations')

    // One walk, but each page is its own step, and what is read off a page is
    // asserted softly, so a wrong figure on one page is reported against that
    // page without hiding the pages after it. Arriving on a page stays a hard
    // check, since nothing on a page that did not arrive can be read, and so
    // does anything a later page is checked against.
    await test.step('Market insights', async () => {
      // Typing the address is not the journey. The regulator area offering the
      // link is the only way a regulator finds the pages at all.
      await homePage.marketInsightsLink().click()

      expect(await marketInsightsPage.headingText()).toContain(
        'Market insights'
      )

      // Each set of figures the publication carries gets its own page, and
      // this one is how a regulator reaches any of them, so every page after
      // this is reached by one of these names.
      expect(await marketInsightsPage.figureSetNames()).toEqual([
        'UK waste balance',
        'Reprocessor and exporter figures: UK',
        ...NATIONS.map(
          (nation) => `Reprocessor and exporter figures: ${nation}`
        ),
        'Outstanding monthly reports: UK'
      ])

      violations.push(
        ...(await scanPageForAccessibilityViolations(
          page,
          'Regulator market insights'
        ))
      )
    })

    const { period, months } = await test.step('UK waste balance', async () => {
      await marketInsightsPage.figureSetLink('UK waste balance').click()

      // The caption renders inside the heading, so it comes back with it. The
      // two are pinned apart: the words the page calls itself by here, and the
      // period below.
      expect(await wasteBalancePage.headingText()).toContain('UK waste balance')

      // The heading says which months the figures cover and the stamp says
      // when they were taken, which a regulator holding the page beside the
      // published workbook reads to tell whether the two were cut over the
      // same span.
      const period = await wasteBalancePage.periodText()

      expect(period).toMatch(PERIOD)
      expect
        .soft(await wasteBalancePage.dataTakenAtText())
        .toMatch(DATA_TAKEN_AT)

      const { material, accreditationType, total, publishedTotal } =
        WASTE_BALANCE_HEADINGS
      const headings = await wasteBalancePage.columnHeadings()
      const months = headings.slice(
        headings.indexOf(accreditationType) + 1,
        headings.indexOf(total)
      )

      expect
        .soft(headings)
        .toEqual([
          material,
          accreditationType,
          ...months,
          total,
          ...(headings.includes(publishedTotal) ? [publishedTotal] : [])
        ])

      // The columns run from January to the last complete month, so they are
      // the opening stretch of the calendar with nothing skipped. Every other
      // page is checked against these months, so they are settled here.
      expect(months.length).toBeGreaterThan(0)
      expect(months).toEqual(MONTHS_OF_THE_YEAR.slice(0, months.length))

      // The seeded operator reprocesses, so its tonnage reaches the page under
      // that accreditation type. Other journeys seed their own operators while
      // this one runs, so the column is read whole rather than by row.
      expect
        .soft(await wasteBalancePage.accreditationTypes())
        .toContain('Reprocessor')

      // Every cell states a tonnage to two decimal places, grouped in
      // thousands, including the months a row credited nothing, which the
      // publication prints as zero rather than leaving blank. Collecting the
      // cells that fail names them in the failure instead of reporting that
      // one of them did.
      const figures = await wasteBalancePage.figures()

      expect.soft(figures.filter((figure) => !TONNAGE.test(figure))).toEqual([])

      // The seeded summary log credits a complete month of the reporting
      // year, so the page is showing real tonnage rather than a table of
      // zeroes.
      expect.soft(figures.some((figure) => asNumber(figure) > 0)).toBe(true)

      expect
        .soft(
          (await wasteBalancePage.publishedTotals()).filter(
            (figure) => figure !== '' && !TONNAGE.test(figure)
          )
        )
        .toEqual([])

      // Beneath the figures, each month says how many of the monthly reports
      // it expected the figures include, and the period says the same under
      // the total, so a thin month can be told from one whose reporters have
      // not all filed.
      const reportCounts = await wasteBalancePage.reportCounts()

      expect.soft(reportCounts).toHaveLength(months.length + 1)
      expect
        .soft(reportCounts.filter((count) => !REPORT_COUNT.test(count)))
        .toEqual([])

      violations.push(
        ...(await scanPageForAccessibilityViolations(
          page,
          'Regulator market insights waste balance'
        ))
      )

      // The trail back is the only way on to the other sets of figures, so
      // the journey walks it rather than addressing the next page directly.
      await wasteBalancePage.crumbLink('Market insights').click()

      return { period, months }
    })

    const year = /** @type {RegExpMatchArray} */ (period.match(PERIOD))[2]
    const tableCaptionsForThePeriod = months.flatMap((month) => [
      `Reprocessor data for ${month} ${year}`,
      `Exporter data for ${month} ${year}`
    ])

    // The UK figures and each nation's are read the same way. Every page
    // covers the period the clock decides, so the figures a regulator reads
    // here are the ones the waste balance was cut over, and a nation is a
    // filter on the figures rather than on the months, so a month that came
    // back missing would be the service dropping it, not the nation having
    // nothing to report in it.
    for (const region of ['UK', ...NATIONS]) {
      const figureSet = `Reprocessor and exporter figures: ${region}`

      await test.step(figureSet, async () => {
        await marketInsightsPage.figureSetLink(figureSet).click()

        expect(await figuresPage.headingText()).toContain(figureSet)

        expect.soft(await figuresPage.periodText()).toBe(period)
        expect.soft(await figuresPage.dataTakenAtText()).toMatch(DATA_TAKEN_AT)

        // Every month of the period brings a reprocessor table and an
        // exporter table, each naming the month it covers. Naming the whole
        // set is what catches a month that arrived twice or not at all, which
        // counting them would not.
        expect
          .soft(await figuresPage.tableCaptions())
          .toEqual(tableCaptionsForThePeriod)

        // Every material is served for every month whether or not anything
        // was reported into it, and every cell states a tonnage or a sum of
        // money, with a zero where nothing was reported rather than a blank.
        // What lands in a nation's cells depends on which regulator the seeded
        // operator registered with, which this journey does not pin, so they
        // are read for their form rather than their value.
        const figures = await figuresPage.figures()

        expect.soft(figures.length).toBeGreaterThan(0)
        expect
          .soft(figures.filter((figure) => !FIGURE.test(figure)))
          .toEqual([])

        violations.push(
          ...(await scanPageForAccessibilityViolations(
            page,
            `Regulator market insights ${region} figures`
          ))
        )

        await figuresPage.crumbLink('Market insights').click()
      })
    }

    await test.step('Outstanding monthly reports: UK', async () => {
      await marketInsightsPage
        .figureSetLink('Outstanding monthly reports: UK')
        .click()

      expect(await outstandingReturnsPage.headingText()).toContain(
        'Outstanding monthly reports'
      )

      // Every set of figures covers the period the clock decides, so this
      // page was cut over the span the others were.
      expect.soft(await outstandingReturnsPage.periodText()).toBe(period)
      expect
        .soft(await outstandingReturnsPage.dataTakenAtText())
        .toMatch(DATA_TAKEN_AT)

      // A table per material, each one naming the material it counts. Naming
      // the whole set is what catches a material that arrived twice or not at
      // all, which counting them would not.
      const captions = await outstandingReturnsPage.tableCaptions()

      expect.soft(captions.length).toBeGreaterThan(0)
      expect
        .soft(
          captions.filter(
            (caption) => !caption.startsWith('Reports not submitted for ')
          )
        )
        .toEqual([])

      // Every table carries the same four bands in the same order, and the
      // same months as the waste balance, so a regulator reads one period
      // across every page.
      expect
        .soft(await outstandingReturnsPage.tonnageBands())
        .toEqual(captions.map(() => TONNAGE_BANDS))
      expect
        .soft(await outstandingReturnsPage.columnHeadings())
        .toEqual(captions.map(() => ['Tonnage band', ...months]))

      // Every cell states a whole number, including the bands nothing is
      // outstanding in, which the publication prints as zero rather than
      // leaving blank.
      const counts = await outstandingReturnsPage.counts()

      expect.soft(counts.length).toBeGreaterThan(0)
      expect
        .soft(counts.filter((count) => !OUTSTANDING_COUNT.test(count)))
        .toEqual([])

      violations.push(
        ...(await scanPageForAccessibilityViolations(
          page,
          'Regulator market insights outstanding reports'
        ))
      )
    })

    await assertNoSeriousOrCriticalViolations(violations)
  })
})
