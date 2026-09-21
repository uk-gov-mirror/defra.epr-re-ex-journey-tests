/**
 * Plans the operators a simulator run will create.
 *
 * Pure and seeded: nothing here touches an API, a clock or the filesystem, and
 * the same settings always give the same population. The result is the input
 * every later planner reads — the summary log row plan, the event calendar and
 * the executors that replay them.
 *
 * Shapes and settings are documented in `README.md` beside this file.
 */

import { MATERIALS } from '../../materials.js'
import { DEFAULT_CALIBRATION } from './calibration.js'
import { PROFILE_MIXES, buildArchetypes, buildProfile } from './profiles.js'
import { allocate, createRandom } from './random.js'

/**
 * @typedef {Object} PlannedAccreditation
 * @property {'approved' | 'suspended' | 'cancelled'} status
 * @property {string} tonnageBand - as `test/support/generator.js` spells it
 * @property {string} validFrom - ISO date, the day the registration opened
 * @property {string} validTo - ISO date, the last day of that accreditation year
 */

/**
 * @typedef {Object} PlannedRegistration
 * @property {string} id
 * @property {string} organisationId
 * @property {string} agency - EA, NIEA, NRW or SEPA
 * @property {string} nation
 * @property {'exporter' | 'reprocessor'} processingType
 * @property {typeof MATERIALS[number]} material
 * @property {string | null} siteId - the site this reprocesses at; null for an exporting registration
 * @property {'approved' | 'cancelled'} status
 * @property {string} activeFrom - ISO date
 * @property {PlannedAccreditation | null} accreditation - null where the operator is registered but not accredited
 */

/**
 * @typedef {Object} PlannedOperator
 * @property {string} id
 * @property {'exporter' | 'reprocessor' | 'both'} type
 * @property {string} agency
 * @property {string} nation
 * @property {string[]} materials - suffixes, sorted
 * @property {{id: string}[]} sites - empty for an exporting-only operator
 * @property {PlannedRegistration[]} registrations
 * @property {import('./profiles.js').BehaviourProfile} profile
 */

/**
 * @typedef {Object} PlannedPopulation
 * @property {string | number} seed
 * @property {number} scale
 * @property {string} profileMix
 * @property {PlannedOperator[]} organisations
 */

const MATERIALS_BY_SUFFIX = Object.fromEntries(
  MATERIALS.map((material) => [material.suffix, material])
)

const REGISTERED_ONLY = 'none'

const identifier = (prefix, index) =>
  `${prefix}-${String(index).padStart(4, '0')}`

const dayCount = (from, to) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000)

const addDays = (from, days) =>
  new Date(Date.parse(from) + days * 86400000).toISOString().slice(0, 10)

const endOfYear = (date) => `${date.slice(0, 4)}-12-31`

const addMonth = (date) => {
  const [year, month] = date.split('-').map(Number)
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`
}

/**
 * Fit one spread inside another, largest to largest, so nothing is asked to
 * hold more than it has room for.
 *
 * The register says 236 organisations hold a single registration but 261 hold
 * a single material, so drawing the two independently keeps asking a
 * one-registration organisation to carry three materials. Sites are the same
 * shape of problem: 176 of them across 184 reprocessing registrations, so an
 * independent draw strands sites nothing is registered on. Ordering both
 * spreads first distorts neither.
 *
 * A floor works the other way: a holder that needs more than the spread
 * offers takes what it needs. Each count goes to the neediest holder with
 * room for it, so the floors cost the spread as little as possible.
 *
 * @param {number[]} capacities - how much each holder has room for
 * @param {number[]} counts - the spread to fit inside them, one count per holder
 * @param {number[]} [floors] - the least each holder has to be given
 * @returns {number[]} a count per index of `capacities`, never above it
 */
function fitBySize(capacities, counts, floors = []) {
  const holders = capacities.map((capacity, index) => ({
    capacity,
    floor: floors[index] ?? 0,
    index
  }))
  const neediest = (candidates) =>
    candidates.reduce((best, holder) =>
      holder.floor > best.floor ||
      (holder.floor === best.floor && holder.capacity > best.capacity)
        ? holder
        : best
    )

  const fitted = Array(capacities.length).fill(0)
  for (const count of [...counts].sort((a, b) => b - a)) {
    const withRoom = holders.filter(
      ({ floor, capacity }) => floor <= count && count <= capacity
    )
    const holder = neediest(withRoom.length > 0 ? withRoom : holders)
    holders.splice(holders.indexOf(holder), 1)
    fitted[holder.index] = Math.min(
      Math.max(count, holder.floor),
      holder.capacity
    )
  }
  return fitted
}

/**
 * Only an organisation with room for two registrations can hold both an
 * exporting and a reprocessing one, so the "both" organisations go on those,
 * smallest first: most of the register's are an operator that exports and
 * reprocesses one material, and a two-registration organisation is the only
 * place that shape fits.
 *
 * An organisation of one processing type on one site holds a material per
 * registration, so one whose registration count is not a count of materials
 * the register shows is "both" before any of them: the register's five- and
 * eight-registration organisations all do both, and drawing one as an
 * exporter would plan a five-material exporter the register has not got.
 */
function assignTypes(register, registrationCounts, random) {
  const requested = allocate(
    register.organisationType,
    registrationCounts.length,
    random
  )
  const bothWanted = requested.filter((type) => type === 'both').length

  const materialCountsHeld = new Set(
    Object.entries(register.materialsPerOrganisation)
      .filter(([, organisations]) => organisations > 0)
      .map(([held]) => Number(held))
  )
  const mustBeBoth = ({ count }) => Number(!materialCountsHeld.has(count))
  const roomForBoth = random
    .shuffle(
      registrationCounts
        .map((count, index) => ({ count, index }))
        .filter(({ count }) => count >= 2)
    )
    .sort((a, b) => mustBeBoth(b) - mustBeBoth(a) || a.count - b.count)
    .map(({ index }) => index)
  const both = new Set(roomForBoth.slice(0, bothWanted))

  const singleTypes = allocate(
    {
      exporter: register.organisationType.exporter,
      reprocessor: register.organisationType.reprocessor
    },
    registrationCounts.length - both.size,
    random
  )

  let next = 0
  return registrationCounts.map((_, index) =>
    both.has(index) ? 'both' : singleTypes[next++]
  )
}

/**
 * An exporting organisation exports everything it holds and a reprocessing one
 * reprocesses everything; an organisation doing both does at least one of each
 * and splits the rest evenly, which is what puts the estate on the register's
 * 205 exporting rows against 184 reprocessing ones.
 */
function assignProcessingTypes(type, registrationCount, random) {
  if (type !== 'both') {
    return Array(registrationCount).fill(type)
  }

  const remainder = allocate(
    { exporter: 1, reprocessor: 1 },
    registrationCount - 2,
    random
  )
  return random.shuffle(['exporter', 'reprocessor', ...remainder])
}

const timesEach = (suffixes) => {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const suffix of suffixes) counts[suffix] = (counts[suffix] ?? 0) + 1
  return counts
}

/**
 * A six-material organisation whose rows are all exporting accepts about one
 * draw in a thousand, and seven materials over seven exporting rows, which
 * the committed register never asks for, one in fifty thousand. So a shape
 * the pool can hold is found long before this, and the estate below draws
 * again when one is not.
 */
const MATERIAL_DRAW_ATTEMPTS = 100000

/**
 * How many times the estate's material rows are dealt out again after some
 * organisation found no shape it could take in what the earlier ones left.
 */
const ESTATE_DRAW_ATTEMPTS = 10

/**
 * @typedef {Record<PlannedRegistration['processingType'], Record<string, number>>} RowPool
 *   rows still to be taken, per processing type and material suffix
 */

/**
 * Take the organisation's rows out of the estate's pool of material rows in
 * one draw: every row from what is left for its processing type, kept only
 * when the rows between them hold exactly the distinct materials the
 * register gave the organisation and no more of one material than the
 * service approves, which is one exporting registration per material and
 * one reprocessing registration per material and site.
 *
 * The pool is what holds the material row totals whatever the organisations'
 * shapes ask of them. Redrawing from the register weights instead would make
 * a one-material organisation with several rows plastic far more often than
 * the register has it.
 *
 * @param {RowPool} rowPool - the rows taken are removed from it
 * @param {PlannedRegistration['processingType'][]} processingTypes - per row
 * @param {number} materialCount - distinct materials the rows must hold between them
 * @param {number} siteCount
 * @param {import('./random.js').Random} random
 * @returns {PlannedRegistration['material'][] | undefined} a material per row, or nothing where the pool holds no shape the organisation can take
 */
function takeMaterials(
  rowPool,
  processingTypes,
  materialCount,
  siteCount,
  random
) {
  const capacity = { exporter: 1, reprocessor: siteCount }

  for (let attempt = 0; attempt < MATERIAL_DRAW_ATTEMPTS; attempt++) {
    const remaining = Object.fromEntries(
      Object.entries(rowPool).map(([processingType, rows]) => [
        processingType,
        { ...rows }
      ])
    )
    const suffixes = processingTypes.map((processingType) => {
      const suffix = random.weighted(remaining[processingType])
      remaining[processingType][suffix]--
      return suffix
    })
    const rowsOfEach = timesEach(
      suffixes.map((suffix, row) => `${processingTypes[row]} ${suffix}`)
    )
    const withinCapacity = processingTypes.every(
      (processingType, row) =>
        rowsOfEach[`${processingType} ${suffixes[row]}`] <=
        capacity[processingType]
    )

    if (withinCapacity && new Set(suffixes).size === materialCount) {
      Object.assign(rowPool, remaining)
      return suffixes.map((suffix) => MATERIALS_BY_SUFFIX[suffix])
    }
  }
  return undefined
}

/**
 * The register's rows per material and processing type are a quota over the
 * rows the plan holds of each type, and each organisation takes its rows
 * from that pool. The organisations with the most rows take theirs first,
 * while the pool still holds every shape, and an organisation that finds no
 * shape in what is left hands the whole estate's rows back to be dealt again.
 *
 * @param {import('./calibration.js').Calibration['register']} register
 * @param {PlannedRegistration['processingType'][][]} processingTypesByOrganisation
 * @param {number[]} materialCounts - distinct materials per organisation
 * @param {number[]} siteCounts - per organisation
 * @param {import('./random.js').Random} random
 * @returns {PlannedRegistration['material'][][]} a material per row, per organisation
 */
function assignMaterials(
  register,
  processingTypesByOrganisation,
  materialCounts,
  siteCounts,
  random
) {
  const rowsOfEachType = timesEach(processingTypesByOrganisation.flat())
  const byMostRows = [...processingTypesByOrganisation.keys()].sort(
    (a, b) =>
      processingTypesByOrganisation[b].length -
      processingTypesByOrganisation[a].length
  )

  let refused = byMostRows[0]
  for (let attempt = 0; attempt < ESTATE_DRAW_ATTEMPTS; attempt++) {
    /** @type {RowPool} */
    const rowPool = { exporter: {}, reprocessor: {} }
    for (const [processingType, weights] of Object.entries(
      register.rowsByTypeAndMaterial
    )) {
      rowPool[processingType] = timesEach(
        allocate(weights, rowsOfEachType[processingType] ?? 0, random)
      )
    }

    /** @type {PlannedRegistration['material'][][]} */
    const materials = []
    const short = byMostRows.find((index) => {
      const taken = takeMaterials(
        rowPool,
        processingTypesByOrganisation[index],
        materialCounts[index],
        siteCounts[index],
        random
      )
      if (taken) materials[index] = taken
      return !taken
    })
    if (short === undefined) return materials
    refused = short
  }

  const rows = Object.entries(timesEach(processingTypesByOrganisation[refused]))
    .map(([processingType, count]) => `${count} ${processingType}`)
    .join(' and ')
  throw new Error(
    `An organisation cannot hold ${materialCounts[refused]} materials across ${rows} registrations on ${siteCounts[refused]} sites from the material rows the calibration registers`
  )
}

/**
 * Two reprocessing registrations of one material go on different sites, since
 * the service refuses a second approval of a material at one site. Placing
 * the rows a material at a time around the sites does that and still leaves
 * no site without a row.
 *
 * @param {PlannedRegistration['processingType'][]} processingTypes - per row
 * @param {PlannedRegistration['material'][]} materials - per row
 * @param {PlannedOperator['sites']} sites
 * @returns {(string | null)[]} a site id per row; null for an exporting row
 */
function assignSites(processingTypes, materials, sites) {
  /** @type {Map<string, number[]>} */
  const rowsByMaterial = new Map()
  processingTypes.forEach((processingType, row) => {
    if (processingType !== 'reprocessor') return
    const { suffix } = materials[row]
    rowsByMaterial.set(suffix, [...(rowsByMaterial.get(suffix) ?? []), row])
  })

  const siteIds = Array(processingTypes.length).fill(null)
  let next = 0
  for (const rows of rowsByMaterial.values()) {
    for (const row of rows) siteIds[row] = sites[next++ % sites.length].id
  }
  return siteIds
}

/**
 * Put back any status the quota rounded away. Suspension and cancellation are
 * two rows each in 389, so below about half scale they floor to nothing and a
 * scaled-down run stops exercising them at all. Wherever there are rows to
 * spare, each status the register carries gets at least one, taken off the
 * commonest.
 */
function withEveryStatus(statuses, distribution, random) {
  const present = new Set(statuses)
  const missing = Object.keys(distribution).filter(
    (key) => distribution[key] > 0 && !present.has(key)
  )
  if (missing.length === 0) return statuses

  const commonest = Object.keys(distribution).sort(
    (a, b) => distribution[b] - distribution[a]
  )[0]
  const spare = random.shuffle(
    statuses
      .map((status, index) => ({ status, index }))
      .filter(({ status }) => status === commonest)
      .map(({ index }) => index)
  )

  // Keep one row on the commonest status. A run whose every registration was
  // taken for a rarity has nothing approved to report against, which at the
  // smallest scales is every run.
  const filled = [...statuses]
  missing.slice(0, spare.length - 1).forEach((key, rank) => {
    filled[spare[rank]] = key
  })
  return filled
}

/**
 * Most registrations opened on the first day of the scheme and the rest are
 * handed out by the month the register dates them to, then given a day within
 * it. Drawing the rest evenly across the whole window instead would put a
 * registration the register places in August into March, owing five monthly
 * returns it never owed.
 */
function assignActiveFrom(register, registrationCount, random) {
  const { goLive, goLiveCount, scatteredByMonth } = register.activeFrom

  return allocate(
    { goLive: goLiveCount, ...scatteredByMonth },
    registrationCount,
    random
  ).map((when) => {
    if (when === 'goLive') return goLive
    const firstOfMonth = `${when}-01`
    const days = dayCount(firstOfMonth, addMonth(firstOfMonth))
    // The go-live day is a bucket of its own, so a scattered registration in
    // that month opened on some later day.
    const first = when === goLive.slice(0, 7) ? 1 : 0
    return addDays(firstOfMonth, random.int(first, days - 1))
  })
}

/**
 * How much an operator reports and issues, from the tonnage bands it holds,
 * normalised so the estate averages one. Normalising against the population
 * rather than a fixed divisor keeps the estate total on the calibrated monthly
 * rate whatever band mix a given scale happens to draw.
 */
function volumeFactors(bandWeights, organisations) {
  const smallest = Math.min(...Object.values(bandWeights))

  const raw = organisations.map((organisation) => {
    const weights = organisation.registrations.map(
      (registration) =>
        bandWeights[registration.accreditation?.tonnageBand] ?? smallest
    )
    return weights.reduce((sum, weight) => sum + weight, 0) / weights.length
  })

  const mean = raw.reduce((sum, weight) => sum + weight, 0) / raw.length
  return raw.map((weight) => weight / mean)
}

/**
 * @param {{seed?: string | number, scale?: number, profileMix?: string, calibration?: import('./calibration.js').Calibration}} [settings]
 *   `scale` of 1 plans the register the calibration describes, which for the
 *   default is 293 organisations holding 389 registrations. `profileMix` names
 *   one of `PROFILE_MIXES`. `calibration` is every figure the plan is built
 *   from; pass `loadCalibration()` to pick up an overlay.
 * @returns {PlannedPopulation}
 */
export function planPopulation({
  seed = 'pepr',
  scale = 1,
  profileMix = 'production',
  calibration = DEFAULT_CALIBRATION
} = {}) {
  if (!PROFILE_MIXES[profileMix]) {
    throw new Error(
      `Unknown profile mix "${profileMix}" — expected one of ${Object.keys(PROFILE_MIXES).join(', ')}`
    )
  }
  if (!(scale > 0)) {
    throw new Error(`Scale must be above zero — got ${scale}`)
  }

  const { register, agencyNations } = calibration
  const unnamedAgency = Object.keys(register.agencyRows).find(
    (agency) => !(agency in agencyNations)
  )
  if (unnamedAgency) {
    throw new Error(
      `The calibration registers rows against "${unnamedAgency}" but gives it no nation`
    )
  }

  const random = createRandom(seed)
  const organisationCount = Math.max(
    1,
    Math.round(register.organisations * scale)
  )

  const registrationCounts = allocate(
    register.registrationsPerOrganisation,
    organisationCount,
    random
  ).map(Number)
  const materialCounts = allocate(
    register.materialsPerOrganisation,
    organisationCount,
    random
  ).map(Number)

  const types = assignTypes(register, registrationCounts, random)
  // An operator is regulated by one agency and its registrations inherit it,
  // so the register's rows per agency is a quota over organisations rather
  // than over rows. Across seeds each agency lands on its register count, and
  // lands tighter than drawing every row on its own would, because the quota
  // is exact and most organisations hold a single registration. One run still
  // reads light or heavy on a small agency: over 200 seeds of the committed
  // calibration, Northern Ireland's 45 rows came out anywhere from 35 to 62.
  const agencies = allocate(register.agencyRows, organisationCount, random)

  const processingTypesByOrganisation = registrationCounts.map(
    (registrationCount, index) =>
      assignProcessingTypes(types[index], registrationCount, random)
  )
  const rowsOfType = (index, processingType) =>
    processingTypesByOrganisation[index].filter(
      (type) => type === processingType
    ).length

  // A reprocessing organisation needs a site per registration of one
  // material, so the sites go first to the organisations whose material
  // count leaves them short.
  const materialsBeforeSites = fitBySize(registrationCounts, materialCounts)
  const reprocessorOrganisations = processingTypesByOrganisation
    .map((_, index) => index)
    .filter((index) => types[index] !== 'exporter')
  const siteCounts = fitBySize(
    reprocessorOrganisations.map((index) => rowsOfType(index, 'reprocessor')),
    allocate(
      register.sitesPerReprocessorOrganisation,
      reprocessorOrganisations.length,
      random
    ).map(Number),
    reprocessorOrganisations.map((index) =>
      Math.ceil(rowsOfType(index, 'reprocessor') / materialsBeforeSites[index])
    )
  )
  const sitesByOrganisation = Array(organisationCount).fill(0)
  reprocessorOrganisations.forEach((index, rank) => {
    sitesByOrganisation[index] = siteCounts[rank]
  })

  // An organisation exports each material once and reprocesses it once per
  // site, so it needs at least as many materials as that leaves room for.
  const fewestMaterials = registrationCounts.map((_, index) => {
    const reprocessing = rowsOfType(index, 'reprocessor')
    return Math.max(
      rowsOfType(index, 'exporter'),
      reprocessing === 0
        ? 0
        : Math.ceil(reprocessing / sitesByOrganisation[index])
    )
  })
  const fittedMaterialCounts = fitBySize(
    registrationCounts,
    materialCounts,
    fewestMaterials
  )

  const materialsByOrganisation = assignMaterials(
    register,
    processingTypesByOrganisation,
    fittedMaterialCounts,
    sitesByOrganisation,
    random
  )
  const planned = processingTypesByOrganisation.map(
    (processingTypes, index) => ({
      processingTypes,
      materials: materialsByOrganisation[index]
    })
  )

  const registrationTotal = planned.reduce(
    (sum, organisation) => sum + organisation.processingTypes.length,
    0
  )
  const accreditationStatuses = withEveryStatus(
    allocate(register.accreditationStatus, registrationTotal, random),
    register.accreditationStatus,
    random
  )
  const activeFroms = assignActiveFrom(register, registrationTotal, random)
  const tonnageBands = allocate(
    register.tonnageBand,
    accreditationStatuses.filter((status) => status !== REGISTERED_ONLY).length,
    random
  )

  let nextRegistration = 0
  let nextBand = 0

  const registered = planned.map(({ processingTypes, materials }, index) => {
    const agency = agencies[index]
    const organisationId = identifier('OP', index + 1)
    const sites = Array.from(
      { length: sitesByOrganisation[index] },
      (_, site) => ({ id: `${organisationId}-S${site + 1}` })
    )

    const siteIds = assignSites(processingTypes, materials, sites)
    const registrations = processingTypes.map((processingType, row) => {
      const at = nextRegistration++
      const activeFrom = activeFroms[at]
      const accreditationStatus = accreditationStatuses[at]

      return {
        id: `${organisationId}-R${row + 1}`,
        organisationId,
        agency,
        nation: agencyNations[agency],
        processingType,
        // A copy, so a caller that edits a registration's material cannot
        // reach back into the shared vocabulary and change every later plan.
        material: { ...materials[row] },
        siteId: siteIds[row],
        // The register carries two cancelled registrations and two cancelled
        // accreditations, which are the same two rows: a cancelled
        // registration has nothing left to be accredited for.
        status: accreditationStatus === 'cancelled' ? 'cancelled' : 'approved',
        activeFrom,
        accreditation:
          accreditationStatus === REGISTERED_ONLY
            ? null
            : {
                status: accreditationStatus,
                tonnageBand: tonnageBands[nextBand++],
                validFrom: activeFrom,
                validTo: endOfYear(activeFrom)
              }
      }
    })

    return {
      id: organisationId,
      type: types[index],
      agency,
      nation: agencyNations[agency],
      materials: [
        ...new Set(materials.map((material) => material.suffix))
      ].sort(),
      sites,
      registrations
    }
  })

  const archetypes = allocate(
    PROFILE_MIXES[profileMix],
    organisationCount,
    random
  )
  const factors = volumeFactors(calibration.tonnageBandPrnWeight, registered)
  const dispositions = buildArchetypes(calibration)
  const organisations = registered.map((organisation, index) => ({
    ...organisation,
    profile: buildProfile({
      archetypes: dispositions,
      archetype: archetypes[index],
      volumeFactor: factors[index],
      random
    })
  }))

  return { seed, scale, profileMix, organisations }
}
