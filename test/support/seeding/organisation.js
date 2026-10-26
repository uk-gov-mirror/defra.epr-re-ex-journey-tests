import { Accreditation, Organisation, Registration } from '../generator.js'

import { fakerEN_GB } from '@faker-js/faker'
import { expect } from 'chai'
import { BaseAPI } from '../../apis/base-api.js'
import { AuthClient } from '../auth.js'
import { trackCreatedOrgId } from '../cleanup-tracker.js'
import { currentYear } from '../date.js'
import { MATERIALS } from '../materials.js'
import { generateNumbers } from '../reg-acc-number.js'
import { accreditationPath } from './natural-key-paths.js'
import {
  assertSuccessResponse,
  assertSuccessResponseWithoutBody
} from '../response-assertions.js'

// Returns the most recently completed reporting period for the given cadence.
// Quarterly: periods 1–4 map to Q1–Q4. Monthly: periods 1–12 map to Jan–Dec.
export function lastCompletedPeriod(cadence) {
  const now = new Date()
  const month = now.getUTCMonth() + 1
  const year = now.getUTCFullYear()

  if (cadence === 'monthly') {
    return month === 1
      ? { year: year - 1, period: 12 }
      : { year, period: month - 1 }
  }

  const currentQuarter = Math.ceil(month / 3)
  return currentQuarter === 1
    ? { year: year - 1, period: 4 }
    : { year, period: currentQuarter - 1 }
}

/** @param {'monthly' | 'quarterly'} cadence */
export const validFromWithClosedPeriod = (cadence) =>
  `${lastCompletedPeriod(cadence).year}-01-01`

/** @param {'monthly' | 'quarterly'} cadence */
export const reportsLandingHasNoClosedPeriod = (cadence) =>
  lastCompletedPeriod(cadence).year !== currentYear()

/**
 * A regNumber and accNumber for a registration that updateMigratedOrganisation
 * has to approve, where the spec has no other use for the numbers.
 */
export const fillerNumbers = () =>
  generateNumbers({ wasteProcessingType: 'reprocessor', materialSuffix: 'PA' })

export async function createOrgWithAllWasteProcessingTypeAllMaterials() {
  const wasteProcessingTypes = [
    {
      wasteProcessingType: 'Reprocessor',
      street: 'reprocessor input street',
      type: 'input'
    },
    {
      wasteProcessingType: 'Reprocessor',
      street: 'reprocessor output street',
      type: 'output'
    },
    { wasteProcessingType: 'Exporter', street: 'exporter street', type: '' }
  ]
  const dataRows = []

  for (const wasteProcessingType of wasteProcessingTypes) {
    for (const material of MATERIALS) {
      const updateDataRow = {}
      updateDataRow.material = material.material
      updateDataRow.glassRecyclingProcess = material.glassRecyclingProcess
      updateDataRow.wasteProcessingType =
        wasteProcessingType.wasteProcessingType
      updateDataRow.street = wasteProcessingType.street
      dataRows.push(updateDataRow)
    }
  }

  const organisationDetails = await createLinkedOrganisation(dataRows)

  const updateDataRows = []
  for (let i = 0; i < wasteProcessingTypes.length; i++) {
    for (const material of MATERIALS) {
      /** @type {import('../reg-acc-number.js').ProcessingType} */
      let wasteProcessingType = 'exporter'
      const updateDataRow = {}
      if (wasteProcessingTypes[i].type !== '') {
        updateDataRow.reprocessingType = wasteProcessingTypes[i].type
        wasteProcessingType = 'reprocessor'
      }
      Object.assign(
        updateDataRow,
        generateNumbers({
          wasteProcessingType,
          materialSuffix: material.suffix
        })
      )
      updateDataRow.status = 'approved'
      updateDataRows.push(updateDataRow)
    }
  }

  updateDataRows[0].email = `sanity_${fakerEN_GB.internet.email()}`

  const migratedOrganisation = await updateMigratedOrganisation(
    organisationDetails.refNo,
    updateDataRows
  )

  const userEmail = migratedOrganisation.email
  return { organisationDetails, userEmail }
}

// Examples
// dataRows = [{ material: 'Paper or board (R3)', wasteProcessingType: 'Reprocessor'}, { material: 'Steel (R4)', wasteProcessingType: 'Exporter'}]
export async function createLinkedOrganisation(dataRows) {
  const baseAPI = new BaseAPI()

  const organisation = new Organisation()
  let payload =
    dataRows[0].wasteProcessingType === 'Reprocessor'
      ? organisation.toNonRegisteredUKSoleTraderPayload()
      : organisation.toPayload()

  let response = await baseAPI.post(
    '/v1/apply/organisation',
    JSON.stringify(payload)
  )
  expect(response.statusCode).to.equal(200)

  /**
   * @typedef {Object} OrgCreatedResponse
   * @property {number} orgId
   * @property {string} orgName
   * @property {string} referenceNumber
   */
  const orgResponseData = /** @type {OrgCreatedResponse} */ (
    await response.body.json()
  )

  const orgId = orgResponseData?.orgId
  trackCreatedOrgId(orgId)
  const refNo = orgResponseData?.referenceNumber

  const registrations = []

  for (const dataRow of dataRows) {
    let material = 'Paper or board (R3)'
    const glassRecyclingProcess = dataRow.glassRecyclingProcess?.trim()
    if (dataRow.material !== '') {
      material = dataRow.material
    }
    const registration = new Registration(
      orgId,
      refNo,
      dataRow.street || undefined,
      dataRow.postcode || undefined,
      dataRow.town || undefined
    )
    payload =
      dataRow.wasteProcessingType === 'Reprocessor'
        ? registration.toAllMaterialsPayload(material, glassRecyclingProcess)
        : registration.toExporterPayload(material, glassRecyclingProcess)
    response = await baseAPI.post(
      '/v1/apply/registration',
      JSON.stringify(payload)
    )
    expect(response.statusCode).to.equal(201)
    registrations.push(registration)

    if (!dataRow.withoutAccreditation) {
      const accreditation = new Accreditation(orgId, refNo)
      accreditation.postcode = registration.postcode
      if (dataRow.tonnageBand) {
        accreditation.tonnageBand = dataRow.tonnageBand
      }
      payload =
        dataRow.wasteProcessingType === 'Reprocessor'
          ? accreditation.toReprocessorPayload(material, glassRecyclingProcess)
          : accreditation.toExporterPayload(material, glassRecyclingProcess)

      response = await baseAPI.post(
        '/v1/apply/accreditation',
        JSON.stringify(payload)
      )
      expect(response.statusCode).to.equal(201)
    }
  }

  response = await baseAPI.post(`/v1/dev/form-submissions/${refNo}/migrate`, '')
  expect(response.statusCode).to.equal(200)

  return {
    orgId,
    refNo,
    organisation,
    registrations,
    regAddresses: registrations.map((registration) => registration.address)
  }
}

// Examples for updateDataRows:
// [ { reprocessingType: 'input', ...generateNumbers({ wasteProcessingType: 'reprocessor', materialSuffix: 'PA' }), status: 'approved' }]
// The date a seeded registration and accreditation both start from. Exported
// because a registration has no end date, so what a page lists for it runs from
// here to today - and a spec asserting that set has to derive it rather than
// write it down.
export const SEEDED_VALID_FROM = `${currentYear()}-01-01`

export const SEEDED_CREATED_ON = `${currentYear() - 1}-12-31`

// Migration lands a moment after the migrate call returns, so the first read
// of a freshly migrated organisation can miss it.
async function readOrganisationOnceMigrated(baseAPI, authHeader, orgId) {
  const timeout = 5000
  const startTime = Date.now()

  let response
  while (Date.now() - startTime < timeout) {
    response = await baseAPI.get(`/v1/organisations/${orgId}`, authHeader)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } else {
      break
    }
  }

  return assertSuccessResponse(response, `GET /v1/organisations/${orgId}`)
}

/**
 * Reads a migrated organisation as the regulator sees it, lets `amend` change
 * it in place, and writes it back through the non-prod twin of the
 * organisation PUT, which is how a status or a number is seeded: the public
 * route rejects status changes and the transition endpoints enforce number
 * uniqueness.
 *
 * @template T
 * @param {string} refNo
 * @param {(organisation: any) => T} amend
 * @returns {Promise<T>}
 */
export async function amendMigratedOrganisation(refNo, amend) {
  const authClient = new AuthClient()
  const baseAPI = new BaseAPI()
  await authClient.authenticate()

  const data = await readOrganisationOnceMigrated(
    baseAPI,
    authClient.authHeader(),
    refNo
  )
  const result = amend(data)

  const response = await baseAPI.put(
    `/v1/dev/organisations/${refNo}`,
    JSON.stringify({ version: Number(data.version), updateFragment: data }),
    authClient.authHeader()
  )
  await assertSuccessResponse(response, `PUT /v1/dev/organisations/${refNo}`)

  return result
}

/**
 * Approves one registration of a migrated organisation, with the accreditation
 * applied for beside it, where updateMigratedOrganisation approves them all at
 * once. The organisation is approved with its first registration. Indices are
 * positions in the order the registrations and accreditations were applied for.
 * The service writes each status change to the history itself, dated today.
 *
 * @param {string} refNo
 * @param {{registrationIndex: number, accreditationIndex?: number}} indices
 * @param {Object} granted
 * @param {string} granted.regNumber
 * @param {string} [granted.accNumber]
 * @param {'input' | 'output'} [granted.reprocessingType]
 * @param {string} granted.validFrom - ISO date the registration and accreditation run from
 * @param {string} [granted.validTo] - ISO date the accreditation runs to
 * @param {string} granted.submittedToRegulator
 * @returns {Promise<{registrationId: string, accreditationId: string | null, email: string}>}
 *   the ids the service gave, and the initial user's email a Defra ID link needs
 */
export function approveMigratedRegistration(
  refNo,
  { registrationIndex, accreditationIndex },
  granted
) {
  return amendMigratedOrganisation(refNo, (data) => {
    const registration = data.registrations[registrationIndex]
    const accreditation =
      accreditationIndex === undefined
        ? null
        : data.accreditations[accreditationIndex]

    registration.status = 'approved'
    registration.validFrom = granted.validFrom
    registration.registrationNumber = granted.regNumber
    registration.submittedToRegulator = granted.submittedToRegulator
    if (granted.reprocessingType) {
      registration.reprocessingType = granted.reprocessingType
    }

    if (accreditation) {
      registration.accreditationId = accreditation.id
      accreditation.status = 'approved'
      accreditation.validFrom = granted.validFrom
      accreditation.validTo = granted.validTo
      accreditation.accreditationNumber = granted.accNumber
      accreditation.submittedToRegulator = granted.submittedToRegulator
      if (granted.reprocessingType) {
        accreditation.reprocessingType = granted.reprocessingType
      }
    }

    // Linking a Defra ID user moves an approved organisation on to active, so
    // a later registration's approval leaves it there.
    if (!['approved', 'active'].includes(data.status)) {
      data.status = 'approved'
      data.submittedToRegulator = granted.submittedToRegulator
    }

    return {
      registrationId: registration.id,
      accreditationId: accreditation?.id ?? null,
      email: data.submitterContactDetails.email
    }
  })
}

/**
 * Seeds an organisation whose single reprocessor registration has been
 * approved since January two years ago, with an accreditation that only
 * starts this year: the organisation spans three years, newest first.
 *
 * Approval and backdating take a PUT each. The service dates a status change
 * today and discards the status history sent with it, so the history is only
 * honoured in a PUT that leaves the statuses as they are.
 *
 * @param {{reprocessingType?: 'input' | 'output'}} [options]
 * @returns {Promise<{refNo: string, email: string, years: number[], organisationNumber: number, registrationNumber: string, registrationId: string}>}
 */
export async function seedOrganisationAcrossYears({
  reprocessingType = 'input'
} = {}) {
  const thisYear = currentYear()
  const firstYear = thisYear - 2
  const createdOn = `${firstYear - 1}-12-31`

  const { orgId, refNo } = await createLinkedOrganisation([
    { material: 'Paper or board (R3)', wasteProcessingType: 'Reprocessor' }
  ])

  const numbers = fillerNumbers()
  const { email, registrationId } = await approveMigratedRegistration(
    refNo,
    { registrationIndex: 0, accreditationIndex: 0 },
    {
      ...numbers,
      reprocessingType,
      validFrom: `${firstYear}-01-01`,
      validTo: `${thisYear + 1}-01-01`,
      submittedToRegulator: 'ea'
    }
  )

  await amendMigratedOrganisation(refNo, (data) => {
    data.registrations[0].statusHistory = [
      { status: 'created', updatedAt: createdOn },
      { status: 'approved', updatedAt: `${firstYear}-01-01` }
    ]
    data.accreditations[0].validFrom = `${thisYear}-01-01`
    data.accreditations[0].statusHistory = [
      { status: 'created', updatedAt: createdOn },
      { status: 'approved', updatedAt: `${thisYear}-01-01` }
    ]
  })

  const years = [thisYear, thisYear - 1, firstYear]
  await assertOrganisationYears(orgId, years)

  return {
    refNo,
    email,
    years,
    organisationNumber: orgId,
    registrationNumber: numbers.regNumber,
    registrationId
  }
}

/**
 * Throws unless the backend reports exactly `expected` as the years the
 * organisation held an approved registration in, so a seed whose backdating
 * did not take fails here rather than passing on the current year alone.
 *
 * @param {number} organisationNumber
 * @param {number[]} expected - newest first
 */
async function assertOrganisationYears(organisationNumber, expected) {
  const authClient = new AuthClient()
  const baseAPI = new BaseAPI()
  await authClient.authenticate()

  const response = await baseAPI.get(
    `/organisations/${organisationNumber}/years`,
    authClient.authHeader()
  )
  const { years } = await assertSuccessResponse(
    response,
    `GET /organisations/${organisationNumber}/years`
  )

  expect(years).to.deep.equal(expected)
}

/**
 * Moves a registration, its accreditation or both to a new status, as the
 * regulator would. The service dates the change today.
 *
 * @param {string} refNo
 * @param {{registrationIndex: number, accreditationIndex?: number}} indices
 * @param {{registration?: string, accreditation?: string}} statuses
 */
export function changeMigratedStatus(
  refNo,
  { registrationIndex, accreditationIndex },
  statuses
) {
  return amendMigratedOrganisation(refNo, (data) => {
    if (statuses.registration) {
      data.registrations[registrationIndex].status = statuses.registration
    }
    if (statuses.accreditation) {
      if (accreditationIndex === undefined) {
        throw new Error(
          `Registration ${registrationIndex} of ${refNo} has no accreditation to make ${statuses.accreditation}`
        )
      }
      data.accreditations[accreditationIndex].status = statuses.accreditation
    }
  })
}

export async function updateMigratedOrganisation(
  orgId,
  updateDataRows,
  submittedToRegulator,
  validFrom = SEEDED_VALID_FROM
) {
  const authClient = new AuthClient()
  const baseAPI = new BaseAPI()

  await authClient.authenticate()

  const data = await readOrganisationOnceMigrated(
    baseAPI,
    authClient.authHeader(),
    orgId
  )

  let accreditationIndex = 0

  const accreditationIds = []
  const registrationIds = []

  for (let i = 0; i < updateDataRows.length; i++) {
    const orgUpdateData = updateDataRows[i]
    data.registrations[i].status = orgUpdateData.status
    data.registrations[i].validFrom = validFrom
    data.registrations[i].registrationNumber = orgUpdateData.regNumber
    data.registrations[i].statusHistory = [
      ...(data.registrations[i].statusHistory || []),
      {
        status: orgUpdateData.status,
        updatedAt: data.registrations[i].validFrom
      }
    ]
    data.registrations[i].statusHistory = (
      data.registrations[i].statusHistory || []
    ).map((entry) => {
      if (entry.status === 'created') {
        return {
          ...entry,
          updatedAt: SEEDED_CREATED_ON
        }
      }
      return entry
    })
    if (orgUpdateData.validFrom?.trim()) {
      data.registrations[i].validFrom = orgUpdateData.validFrom
    }
    if (orgUpdateData.reprocessingType?.trim()) {
      data.registrations[i].reprocessingType = orgUpdateData.reprocessingType
    }
    if (orgUpdateData.glassRecyclingProcess?.trim()) {
      data.registrations[i].glassRecyclingProcess = [
        orgUpdateData.glassRecyclingProcess
      ]
    }
    if (submittedToRegulator) {
      data.registrations[i].submittedToRegulator = submittedToRegulator
    }

    registrationIds.push(data.registrations[i].id)

    if (
      !orgUpdateData.withoutAccreditation &&
      data.accreditations[accreditationIndex]
    ) {
      const j = accreditationIndex
      // accStatus lets the accreditation diverge from the registration's
      // status (e.g. approved registration with a still-created accreditation,
      // ready for the admin grant journey). Defaults to the shared status.
      const accStatus = orgUpdateData.accStatus ?? orgUpdateData.status
      data.registrations[i].accreditationId = data.accreditations[j].id
      data.accreditations[j].status = accStatus
      data.accreditations[j].validFrom = validFrom
      data.accreditations[j].validTo = `${currentYear() + 1}-01-01`
      data.accreditations[j].statusHistory =
        accStatus === 'created'
          ? data.accreditations[j].statusHistory || []
          : [
              ...(data.accreditations[j].statusHistory || []),
              {
                status: accStatus,
                updatedAt: data.accreditations[j].validFrom
              }
            ]
      data.accreditations[j].statusHistory = (
        data.accreditations[j].statusHistory || []
      ).map((entry) => {
        if (entry.status === 'created') {
          return {
            ...entry,
            updatedAt: SEEDED_CREATED_ON
          }
        }
        return entry
      })
      if (orgUpdateData.validFrom?.trim()) {
        data.accreditations[j].validFrom = orgUpdateData.validFrom
      }
      if (orgUpdateData.reprocessingType?.trim()) {
        data.accreditations[j].reprocessingType = orgUpdateData.reprocessingType
      }
      if (orgUpdateData.glassRecyclingProcess?.trim()) {
        data.accreditations[j].glassRecyclingProcess = [
          orgUpdateData.glassRecyclingProcess
        ]
      }
      data.accreditations[j].accreditationNumber = orgUpdateData.accNumber
      if (submittedToRegulator) {
        data.accreditations[j].submittedToRegulator = submittedToRegulator
      }
      accreditationIds.push(data.accreditations[j].id)
      accreditationIndex++
    }
  }

  if (submittedToRegulator) {
    data.submittedToRegulator = submittedToRegulator
  }

  // Replace email address with a newly generated one in Environment to avoid same email address all the time
  const generatedEmail = process.env.ENVIRONMENT
    ? fakerEN_GB.internet.email()
    : data.submitterContactDetails.email
  const email = updateDataRows[0].email || generatedEmail
  data.submitterContactDetails.email = email

  data.status = updateDataRows[0].status
  data.statusHistory = [
    ...(data.statusHistory || []),
    {
      status: updateDataRows[0].status,
      updatedAt: data.registrations[0].validFrom
    }
  ]
  const payload = {
    version: Number(data.version),
    updateFragment: data
  }

  // Statuses and numbers seed through the non-prod twin of the organisation
  // PUT: the public route rejects status changes (PAE-1645) and the
  // transition endpoints enforce number uniqueness.
  const response = await baseAPI.put(
    `/v1/dev/organisations/${orgId}`,
    JSON.stringify(payload),
    authClient.authHeader()
  )
  await assertSuccessResponse(response, `PUT /v1/dev/organisations/${orgId}`)

  return { email, registrationIds, accreditationIds }
}

export async function updateStatus(orgId, newStatus) {
  const authClient = new AuthClient()
  const baseAPI = new BaseAPI()

  await authClient.authenticate()

  let response = await baseAPI.get(
    `/v1/organisations/${orgId}`,
    authClient.authHeader()
  )

  const data = await assertSuccessResponse(
    response,
    `GET /v1/organisations/${orgId}`
  )

  data.accreditations[0].status = newStatus
  const statusChangeDate = new Date(data.accreditations[0].validFrom)
  statusChangeDate.setDate(statusChangeDate.getDate() + 1)
  data.accreditations[0].statusHistory = [
    ...(data.accreditations[0].statusHistory || []),
    {
      status: newStatus,
      updatedAt: statusChangeDate.toISOString().split('T')[0]
    }
  ]

  const payload = {
    version: Number(data.version),
    updateFragment: data
  }

  // Statuses and numbers seed through the non-prod twin of the organisation
  // PUT: the public route rejects status changes (PAE-1645) and the
  // transition endpoints enforce number uniqueness.
  response = await baseAPI.put(
    `/v1/dev/organisations/${orgId}`,
    JSON.stringify(payload),
    authClient.authHeader()
  )

  await assertSuccessResponseWithoutBody(
    response,
    `PUT /v1/dev/organisations/${orgId}`
  )
}

/**
 * Statuses and numbers seed through the non-prod twin of the organisation
 * PUT: the public route rejects status changes (PAE-1645) and the transition
 * endpoints enforce number uniqueness.
 * @param {string} orgId
 * @param {(data: any) => void} change
 */
async function changeOrganisation(orgId, change) {
  const authClient = new AuthClient()
  const baseAPI = new BaseAPI()

  await authClient.authenticate()

  let response = await baseAPI.get(
    `/v1/organisations/${orgId}`,
    authClient.authHeader()
  )

  const data = await assertSuccessResponse(
    response,
    `GET /v1/organisations/${orgId}`
  )

  change(data)

  response = await baseAPI.put(
    `/v1/dev/organisations/${orgId}`,
    JSON.stringify({ version: Number(data.version), updateFragment: data }),
    authClient.authHeader()
  )

  await assertSuccessResponseWithoutBody(
    response,
    `PUT /v1/dev/organisations/${orgId}`
  )
}

// Updates the first registration's status (updateStatus above targets the
// accreditation). Cancelling a registration force-cancels its linked
// accreditation (PAE-1705 Scenario 5) — the backend cascades the change, so
// callers only set the registration side.
export async function updateRegistrationStatus(orgId, newStatus) {
  await changeOrganisation(orgId, (data) => {
    data.registrations[0].status = newStatus
  })

  // A status change records today and ignores a supplied history, so the
  // approval and the change land on one day and the registration reads as
  // never approved. Without a status change the history is honoured, so a
  // second write dates creation before validFrom, the approval at validFrom
  // and the change a day later.
  await changeOrganisation(orgId, (data) => {
    const registration = data.registrations[0]
    const approvedOn = registration.validFrom.split('T')[0]
    const changedOn = new Date(registration.validFrom)
    changedOn.setUTCDate(changedOn.getUTCDate() + 1)

    registration.statusHistory = registration.statusHistory.map((entry) => {
      if (entry.status === 'created') {
        return { ...entry, updatedAt: SEEDED_CREATED_ON }
      }
      if (entry.status === 'approved') {
        return { ...entry, updatedAt: approvedOn }
      }
      if (entry.status === newStatus) {
        return { ...entry, updatedAt: changedOn.toISOString().split('T')[0] }
      }
      return entry
    })
  })
}

/**
 * Seeds overseas site records and links them to an exporter registration.
 * Creates a single approved overseas site, then maps a 3-digit ORS key
 * on the specified registration so that ORS waste balance
 * validation passes for any OSR ID in the summary log data.
 *
 * @param {string} orgRefNo - Organisation reference number
 * @param {number[]} registrationIndices - Indices of the exporter registration
 * @param {number[]} orsIds - Array of ORS IDs to link to the registration
 * @param {string} [validFrom] - ISO date the site's approval runs from
 */
export async function seedOverseasSites(
  orgRefNo,
  registrationIndices = [0],
  orsIds = [100],
  validFrom = '2024-01-01'
) {
  const authClient = new AuthClient()
  const baseAPI = new BaseAPI()

  await authClient.authenticate()

  const siteResponse = await baseAPI.post(
    '/v1/overseas-sites',
    JSON.stringify({
      name: 'Test Overseas Reprocessor',
      address: {
        line1: '1 Test Street',
        townOrCity: 'Test City'
      },
      country: 'Germany',
      validFrom
    }),
    authClient.authHeader()
  )
  const site = await assertSuccessResponse(
    siteResponse,
    'POST /v1/overseas-sites'
  )

  const orgResponse = await baseAPI.get(
    `/v1/organisations/${orgRefNo}`,
    authClient.authHeader()
  )
  const orgData = await assertSuccessResponse(
    orgResponse,
    `GET /v1/organisations/${orgRefNo}`
  )

  const overseasSites = {}
  orsIds.forEach((orsId) => {
    overseasSites[orsId] = {
      overseasSiteId: site.id
    }
  })
  registrationIndices.forEach((registrationIndex) => {
    orgData.registrations[registrationIndex].overseasSites = overseasSites
  })

  const payload = {
    version: Number(orgData.version),
    updateFragment: orgData
  }

  const putResponse = await baseAPI.put(
    `/v1/organisations/${orgRefNo}`,
    JSON.stringify(payload),
    authClient.authHeader()
  )

  await assertSuccessResponse(putResponse, `PUT /v1/organisations/${orgRefNo}`)
}

export async function getOrganisation(refNo) {
  const baseAPI = new BaseAPI()
  const authClient = new AuthClient()
  await authClient.authenticate()
  const orgResponse = await baseAPI.get(
    `/v1/organisations/${refNo}`,
    authClient.authHeader()
  )
  return await assertSuccessResponse(orgResponse, `/v1/organisations/${refNo}`)
}

// Whether the December Waste declaration window is open for an accreditation.
export async function getDecemberPrnEligibility(
  refNo,
  registrationId,
  accreditationId
) {
  const baseAPI = new BaseAPI()
  const authClient = new AuthClient()
  await authClient.authenticate()
  const path = `${await accreditationPath(refNo, registrationId, accreditationId)}/packaging-recycling-notes/december-prn-eligibility`
  const eligibilityResponse = await baseAPI.get(path, authClient.authHeader())
  return await assertSuccessResponse(eligibilityResponse, path)
}
