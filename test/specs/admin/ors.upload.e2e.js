import path from 'node:path'
import os from 'node:os'

import { test, expect } from '@playwright/test'

import { AdminLoginPage } from 'page-objects/admin/login.page'
import { OrsUploadPage } from 'page-objects/admin/ors.upload.page'
import {
  createLinkedOrganisation,
  updateMigratedOrganisation
} from '../../support/seeding/organisation.js'
import {
  createOrsSpreadsheet,
  validOrsSites
} from '../../support/ors-spreadsheet.js'
import { checkAccessibility } from '../../support/accessibility.js'
import { OrganisationsPage } from 'page-objects/admin/organisations.page'
import { OrganisationOverviewPage } from 'page-objects/admin/organisation.overview.page'
import { RegistrationOverviewPage } from 'page-objects/admin/registration.overview.page'
import { RegistrationYearPage } from 'page-objects/admin/registration.year.page'
import { ORSOverviewPage } from 'page-objects/admin/ors.overview.page'

async function uploadWorkbookAndWaitForCompletion(
  orsUploadPage,
  page,
  workbookPath
) {
  await orsUploadPage.open()
  await expect(page).toHaveTitle(/Upload ORS workbooks/)
  await checkAccessibility(page, 'Upload ORS workbooks')

  await orsUploadPage.expectUploadFormVisible()
  await orsUploadPage.uploadWorkbook(workbookPath)
  await orsUploadPage.clickStartUpload()
  await orsUploadPage.waitForStatusPage()

  return orsUploadPage.waitForCompletedOrFailedImport()
}

test.describe('ORS upload flow @orsUpload', () => {
  test('Should upload an ORS workbook and show completed import status', async ({
    page
  }) => {
    const loginPage = new AdminLoginPage(page)
    const orsUploadPage = new OrsUploadPage(page)

    const { orgId, refNo } = await createLinkedOrganisation([
      { material: 'Paper or board (R3)', wasteProcessingType: 'Exporter' }
    ])

    const registrationNumber = `FAKE/REG${orgId}/TEST`
    const accreditationNumber = `FAKE/ACC${orgId}/TEST`

    await updateMigratedOrganisation(refNo, [
      {
        regNumber: registrationNumber,
        accNumber: accreditationNumber,
        status: 'approved'
      }
    ])

    const workbookPath = path.join(os.tmpdir(), `ors-test-${orgId}.xlsx`)

    await createOrsSpreadsheet(workbookPath, {
      metadata: {
        packagingWasteCategory: 'Paper or board',
        orgId,
        registrationNumber,
        accreditationNumber
      },
      sites: validOrsSites
    })

    await loginPage.loginAsServiceMaintainer()

    const finalStatus = await uploadWorkbookAndWaitForCompletion(
      orsUploadPage,
      page,
      workbookPath
    )

    expect(finalStatus).toEqual('Import completed')

    const statusSummary = await orsUploadPage.getStatusSummaryText()
    expect(statusSummary).toContain('Files processed: 1')
    expect(statusSummary).toContain('Successful: 1')
    expect(statusSummary).toContain('Failed: 0')

    const fileResults = await orsUploadPage.getUploadedFileResults()
    expect(fileResults).toHaveLength(1)
    expect(fileResults[0].fileName).toContain(`ors-test-${orgId}`)
    expect(fileResults[0].result).toEqual('success')

    await page.getByRole('link', { name: 'View ORS records' }).click()
    await expect(page).toHaveTitle(/Overseas reprocessing sites/)
    await checkAccessibility(page, 'Overseas sites')
    await orsUploadPage.expectDownloadCsvVisible()

    const csvDownload = await orsUploadPage.fetchListCsv()
    expect(csvDownload.status).toEqual(200)
    expect(csvDownload.contentType).toContain('text/csv')
    expect(csvDownload.contentDisposition).toEqual(
      'attachment; filename="overseas-reprocessing-sites.csv"'
    )
    expect(csvDownload.body).toContain(
      'Org ID,Registration Number,Accreditation Number,ORS ID'
    )
    expect(csvDownload.body).toContain(String(orgId))
    expect(csvDownload.body).toContain(registrationNumber)
    expect(csvDownload.body).toContain(accreditationNumber)
    expect(csvDownload.body).toContain('Fake Recycling Co')

    const expectedHeaders = [
      'Org ID',
      'Registration Number',
      'Accreditation Number',
      'ORS ID',
      'Packaging waste category',
      'Destination country',
      'Overseas reprocessor name',
      'Address line 1',
      'Address line 2',
      'City or town',
      'State, province or region',
      'Postcode or similar',
      'Coordinates',
      'Valid from'
    ]

    const actualHeaders = await orsUploadPage.getListTableHeaders()
    expect(actualHeaders).toEqual(expectedHeaders)

    const rows = await orsUploadPage.getListTableRows()
    expect(rows.length).toBeGreaterThan(0)

    const uploadedRow = rows.find(
      (row) =>
        row[0] === String(orgId) &&
        row[1] === registrationNumber &&
        row[2] === accreditationNumber &&
        row[3] === '001'
    )
    expect(uploadedRow).toBeDefined()
    if (!uploadedRow) {
      throw new Error('uploadedRow not found')
    }
    expect(uploadedRow).toHaveLength(14)
    expect(uploadedRow[4]).not.toEqual('-')
    expect(uploadedRow.slice(5)).toEqual([
      'Testland',
      'Fake Recycling Co',
      '1 Test Street',
      'Unit 99',
      'Testville',
      'Testshire',
      'TEST 001',
      '0.0000,0.0000',
      '1 January 2025'
    ])

    await orsUploadPage.openList('page=1&pageSize=2')
    await orsUploadPage.expectPaginationVisible()

    const pageOneStatus = await orsUploadPage.getPaginationStatusText()
    expect(pageOneStatus).toContain('Showing page 1 of')

    await orsUploadPage.nextPageLink().click()
    await expect(orsUploadPage.paginationStatus()).toContainText(
      'Showing page 2 of'
    )

    const pageTwoRows = await orsUploadPage.getListTableRows()
    expect(pageTwoRows.length).toBeGreaterThan(0)
    expect(pageTwoRows.length).toBeLessThanOrEqual(2)
  })

  // .serial: later tests consume registration numbers and the org name
  // created in "Should upload workbooks for filter tests" via shared
  // closure state - non-serial mode doesn't guarantee that setup runs (or
  // finishes running) before the tests that depend on it.
  test.describe.serial('Registration number filter @orsUpload', () => {
    let alphaRegistrationNumber
    let alphaAccreditationNumber
    let betaRegistrationNumber
    let betaAccreditationNumber
    let organisationName

    // The suite's WDIO original logged in once in the first test of this
    // block and relied on the shared browser session for the rest.
    // Playwright isolates every test in its own context, so log in fresh
    // each time instead.
    test.beforeEach(async ({ page }) => {
      const loginPage = new AdminLoginPage(page)
      await loginPage.loginAsServiceMaintainer()
    })

    test('Should upload workbooks for filter tests', async ({ page }) => {
      const orsUploadPage = new OrsUploadPage(page)

      const { orgId, refNo, organisation } = await createLinkedOrganisation([
        { material: 'Paper or board (R3)', wasteProcessingType: 'Exporter' },
        { material: 'Steel (R4)', wasteProcessingType: 'Exporter' }
      ])

      organisationName = organisation.companyName

      alphaRegistrationNumber = `FAKE/REG${orgId}/ALPHA`
      betaRegistrationNumber = `FAKE/REG${orgId}/BETA`
      alphaAccreditationNumber = `FAKE/ACC${orgId}/ALPHA`
      betaAccreditationNumber = `FAKE/ACC${orgId}/BETA`

      await updateMigratedOrganisation(refNo, [
        {
          regNumber: alphaRegistrationNumber,
          accNumber: alphaAccreditationNumber,
          status: 'approved'
        },
        {
          regNumber: betaRegistrationNumber,
          accNumber: betaAccreditationNumber,
          status: 'approved'
        }
      ])

      const alphaWorkbookPath = path.join(
        os.tmpdir(),
        `ors-alpha-${orgId}.xlsx`
      )
      const betaWorkbookPath = path.join(os.tmpdir(), `ors-beta-${orgId}.xlsx`)

      await createOrsSpreadsheet(alphaWorkbookPath, {
        metadata: {
          packagingWasteCategory: 'Paper or board',
          orgId,
          registrationNumber: alphaRegistrationNumber,
          accreditationNumber: alphaAccreditationNumber
        },
        sites: validOrsSites
      })

      await createOrsSpreadsheet(betaWorkbookPath, {
        metadata: {
          packagingWasteCategory: 'Steel',
          orgId,
          registrationNumber: betaRegistrationNumber,
          accreditationNumber: betaAccreditationNumber
        },
        sites: validOrsSites
      })

      expect(
        await uploadWorkbookAndWaitForCompletion(
          orsUploadPage,
          page,
          alphaWorkbookPath
        )
      ).toEqual('Import completed')
      expect(
        await uploadWorkbookAndWaitForCompletion(
          orsUploadPage,
          page,
          betaWorkbookPath
        )
      ).toEqual('Import completed')
    })

    test('Should clear the registration number filter', async ({ page }) => {
      const orsUploadPage = new OrsUploadPage(page)

      await orsUploadPage.openList()
      await orsUploadPage.filterByRegistrationNumber(alphaRegistrationNumber)
      await orsUploadPage.clearRegistrationNumberFilterLink().click()
      await expect(orsUploadPage.registrationNumberInput).toHaveValue('')
      await expect(
        orsUploadPage.clearRegistrationNumberFilterLink()
      ).toBeHidden()
    })

    test('Should show empty state for non-matching filter', async ({
      page
    }) => {
      const orsUploadPage = new OrsUploadPage(page)

      await orsUploadPage.openList('registrationNumber=NOT-FOUND')
      expect(await orsUploadPage.getInsetText()).toContain(
        "No overseas reprocessing site data found matching 'NOT-FOUND'."
      )
    })

    test('Should be able to view ORS data for an organisation', async ({
      page
    }) => {
      const organisationsPage = new OrganisationsPage(page)
      const organisationOverviewPage = new OrganisationOverviewPage(page)
      const registrationOverviewPage = new RegistrationOverviewPage(page)
      const registrationYearPage = new RegistrationYearPage(page)
      const orsOverviewPage = new ORSOverviewPage(page)

      await organisationsPage.open()
      await organisationsPage.searchFor(organisationName)
      await organisationsPage.viewLink(1)
      await organisationOverviewPage.viewRegistrationLink(1)
      await registrationOverviewPage.viewLatestAccreditedYear()
      await registrationYearPage.viewORSLink().click()
      let orsOverviewHeader = await orsOverviewPage.getHeaderText()
      expect(orsOverviewHeader).toContain(
        organisationName + ' - ' + alphaAccreditationNumber
      )
      let actualOrsTableData = await orsOverviewPage.getORSTableData()
      const expectedOrsTableData = [
        {
          orsId: '001',
          packagingWasteCategory: 'paper',
          destinationCountry: 'Testland',
          overseasReprocessorName: 'Fake Recycling Co',
          addressLine1: '1 Test Street',
          addressLine2: 'Unit 99',
          cityOrTown: 'Testville',
          stateProvinceOrRegion: 'Testshire',
          postcode: 'TEST 001',
          coordinates: '0.0000,0.0000',
          validFrom: '1 January 2025'
        },
        {
          orsId: '002',
          packagingWasteCategory: 'paper',
          destinationCountry: 'Fakestan',
          overseasReprocessorName: 'Bogus Paper Mills',
          addressLine1: '42 Nonsense Avenue',
          addressLine2: '-',
          cityOrTown: 'Faketown',
          stateProvinceOrRegion: 'Nowhere',
          postcode: 'FAKE 002',
          coordinates: '1.0000,1.0000',
          validFrom: '1 January 2025'
        },
        {
          orsId: '003',
          packagingWasteCategory: 'paper',
          destinationCountry: 'Madeupistan',
          overseasReprocessorName: 'Imaginary Exports Ltd',
          addressLine1: '999 Fiction Road',
          addressLine2: 'Floor 0',
          cityOrTown: 'Inventedburg',
          stateProvinceOrRegion: 'Neverland',
          postcode: 'NOPE 003',
          coordinates: '2.0000,2.0000',
          validFrom: '1 January 2025'
        }
      ]
      expect(actualOrsTableData).toEqual(expectedOrsTableData)

      // Return to Organisation Overview Page
      await orsOverviewPage.clickOnBreadcrumbLink(2)
      await organisationOverviewPage.viewRegistrationLink(2)
      await registrationOverviewPage.viewLatestAccreditedYear()

      await registrationYearPage.viewORSLink().click()
      orsOverviewHeader = await orsOverviewPage.getHeaderText()
      expect(orsOverviewHeader).toContain(
        organisationName + ' - ' + betaAccreditationNumber
      )

      const expectedSecondOrsTableData = [
        {
          orsId: '001',
          packagingWasteCategory: 'steel',
          destinationCountry: 'Testland',
          overseasReprocessorName: 'Fake Recycling Co',
          addressLine1: '1 Test Street',
          addressLine2: 'Unit 99',
          cityOrTown: 'Testville',
          stateProvinceOrRegion: 'Testshire',
          postcode: 'TEST 001',
          coordinates: '0.0000,0.0000',
          validFrom: '1 January 2025'
        },
        {
          orsId: '002',
          packagingWasteCategory: 'steel',
          destinationCountry: 'Fakestan',
          overseasReprocessorName: 'Bogus Paper Mills',
          addressLine1: '42 Nonsense Avenue',
          addressLine2: '-',
          cityOrTown: 'Faketown',
          stateProvinceOrRegion: 'Nowhere',
          postcode: 'FAKE 002',
          coordinates: '1.0000,1.0000',
          validFrom: '1 January 2025'
        },
        {
          orsId: '003',
          packagingWasteCategory: 'steel',
          destinationCountry: 'Madeupistan',
          overseasReprocessorName: 'Imaginary Exports Ltd',
          addressLine1: '999 Fiction Road',
          addressLine2: 'Floor 0',
          cityOrTown: 'Inventedburg',
          stateProvinceOrRegion: 'Neverland',
          postcode: 'NOPE 003',
          coordinates: '2.0000,2.0000',
          validFrom: '1 January 2025'
        }
      ]

      actualOrsTableData = await orsOverviewPage.getORSTableData()
      expect(actualOrsTableData).toEqual(expectedSecondOrsTableData)
    })
  })
})
