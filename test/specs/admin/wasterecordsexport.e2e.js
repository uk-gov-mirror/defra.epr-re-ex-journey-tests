import { test, expect } from '@playwright/test'

import { AdminLoginPage } from 'page-objects/admin/login.page'
import { Navigation } from 'page-objects/admin/navigation.page'
import { WasteRecordsExportPage } from 'page-objects/admin/waste.records.export.page'
import { parseCsvBody } from '../../support/csv.js'
import { checkAccessibility } from '../../support/accessibility.js'
import { currentYear } from '../../support/date.js'
import { availableWasteRecordYears } from '../../support/waste-record-years.js'

test.describe('Waste records export page', () => {
  test('An admin downloads one year of waste records @wasteRecordsExport', async ({
    page
  }) => {
    const loginPage = new AdminLoginPage(page)
    const navigation = new Navigation(page)
    const wasteRecordsExportPage = new WasteRecordsExportPage(page)

    await loginPage.open()
    await loginPage.enterCredentials('ea@test.gov.uk', 'pass')
    await loginPage.submitCredentials()
    await navigation.clickOnLink('Waste records export')
    await checkAccessibility(page, 'Waste records export')

    expect(await wasteRecordsExportPage.availableYears()).toEqual(
      await availableWasteRecordYears()
    )
    await expect(wasteRecordsExportPage.yearDropdown()).toHaveValue(
      String(currentYear())
    )

    await wasteRecordsExportPage.yearDropdown().selectOption('2026')
    const csv = await wasteRecordsExportPage.download(
      wasteRecordsExportPage.downloadCsvButton()
    )

    expect(csv.failure).toBeNull()
    expect(csv.filename).toMatch(/^waste-records-2026-.+\.csv$/)
    const [header] = parseCsvBody(csv.body.toString('utf8'))
    expect(header).toEqual(
      expect.arrayContaining([
        'Organisation Name',
        'Registration Number',
        'Accreditation Number'
      ])
    )
  })
})
