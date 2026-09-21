import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MATERIALS } from '../../materials.js'
import { DEFAULT_CALIBRATION } from './calibration.js'
import { planPopulation } from './population.js'

const { agencyNations: AGENCY_NATIONS, register: REGISTER } =
  DEFAULT_CALIBRATION

const population = planPopulation({ seed: 'register' })
const organisations = population.organisations
const registrations = organisations.flatMap(
  (organisation) => organisation.registrations
)
const accreditations = registrations
  .map((registration) => registration.accreditation)
  .filter(Boolean)

const sum = (values) => values.reduce((total, value) => total + value, 0)

const tally = (members, read) => {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const member of members) {
    const key = read(member)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

const near = (actual, target, tolerance) =>
  assert.ok(
    Math.abs(actual - target) <= tolerance,
    `${actual} is not within ${tolerance} of ${target}`
  )

const rowTotal = (counts) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0)

/** The register counts per Annex II process, summed out of its material rows. */
const registerProcessRows = () => {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const materials of Object.values(REGISTER.rowsByTypeAndMaterial)) {
    for (const [suffix, count] of Object.entries(materials)) {
      const material = MATERIALS.find((known) => known.suffix === suffix)
      assert.ok(material, `${suffix} is not a material this repo knows`)
      counts[material.process] = (counts[material.process] ?? 0) + count
    }
  }
  return counts
}

describe('the planned register at full scale', () => {
  it('holds the organisations and registrations the register does', () => {
    assert.equal(organisations.length, REGISTER.organisations)
    assert.equal(registrations.length, REGISTER.registrations)
  })

  it('splits organisations between exporting, reprocessing and both', () => {
    assert.deepEqual(
      tally(organisations, (organisation) => organisation.type),
      REGISTER.organisationType
    )
  })

  it('gives organisations the spread of registrations the register shows', () => {
    assert.deepEqual(
      tally(organisations, (organisation) => organisation.registrations.length),
      REGISTER.registrationsPerOrganisation
    )
  })

  /**
   * Within a few organisations rather than exactly, and over a spread of
   * seeds rather than the one the rest of this block reads. An exporting
   * organisation holds a material per registration, so which organisations
   * the type draw makes exporters decides how many land above the bucket the
   * register gave them. A thousand seeds run within five of the register on
   * every bucket, most of them within one; asserting the spread exactly would
   * pass here and fail in CI on the next change to the draw order.
   */
  it('gives organisations the spread of materials the register shows', () => {
    for (let seed = 0; seed < 20; seed++) {
      const spread = tally(
        planPopulation({ seed: `materials-${seed}` }).organisations,
        (organisation) => organisation.materials.length
      )

      assert.deepEqual(
        Object.keys(spread).sort(),
        Object.keys(REGISTER.materialsPerOrganisation).sort()
      )
      for (const [held, count] of Object.entries(
        REGISTER.materialsPerOrganisation
      )) {
        near(spread[held], count, 6)
      }
    }
  })

  it('never strands a site with nothing registered at it', () => {
    for (const organisation of organisations) {
      const registeredAt = new Set(
        organisation.registrations
          .map((registration) => registration.siteId)
          .filter(Boolean)
      )

      assert.equal(
        registeredAt.size,
        organisation.sites.length,
        `${organisation.id} holds ${organisation.sites.length} sites but registers at ${registeredAt.size}`
      )
    }
  })

  it('never gives an exporting-only organisation a reprocessing site', () => {
    const exporters = organisations.filter(
      (organisation) => organisation.type === 'exporter'
    )

    assert.ok(exporters.length > 0)
    assert.ok(
      exporters.every((organisation) => organisation.sites.length === 0)
    )
  })

  /**
   * An organisation answers to one agency, so the agency quota is handed out
   * per organisation and the register's per-registration counts come out of
   * how many registrations those organisations turn out to hold. That lands on
   * the register in the mean but swings on a single seed, so the row counts are
   * asserted over a spread of seeds below.
   */
  it('gives each agency the share of organisations its registrations imply', () => {
    const counts = tally(organisations, (organisation) => organisation.agency)
    const rowTotal = Object.values(REGISTER.agencyRows).reduce(
      (sum, count) => sum + count,
      0
    )

    for (const [agency, target] of Object.entries(REGISTER.agencyRows)) {
      near(counts[agency], (target / rowTotal) * REGISTER.organisations, 1)
    }
  })

  it('gives every organisation the nation its agency regulates', () => {
    assert.ok(
      organisations.every(
        (organisation) =>
          organisation.nation === AGENCY_NATIONS[organisation.agency]
      )
    )
  })

  it('splits registrations between exporting and reprocessing as the register does', () => {
    const counts = tally(
      registrations,
      (registration) => registration.processingType
    )

    for (const [processingType, materials] of Object.entries(
      REGISTER.rowsByTypeAndMaterial
    )) {
      near(counts[processingType], rowTotal(materials), 20)
    }
  })

  it('splits accreditation status as the register does, registered-only included', () => {
    const counts = tally(registrations, (registration) =>
      registration.accreditation ? registration.accreditation.status : 'none'
    )

    assert.deepEqual(counts, REGISTER.accreditationStatus)
  })

  it('gives a tonnage band to every accreditation and to nothing else', () => {
    assert.equal(
      accreditations.length,
      REGISTER.registrations - REGISTER.accreditationStatus.none
    )
    assert.deepEqual(
      tally(accreditations, (accreditation) => accreditation.tonnageBand),
      REGISTER.tonnageBand
    )
  })

  /**
   * The register dates 369 of its 389 rows, so these counts are a shape handed
   * out over the whole estate rather than a total to reproduce. What has to
   * hold is the proportion, and that each scattered registration lands in the
   * month the register put it in: drawing evenly across the window instead
   * would move one the register places in August back to March, and the
   * simulator counts monthly returns from this date.
   */
  it('opens most registrations on the first day of the scheme and scatters the rest by month', () => {
    const { goLive, goLiveCount, scatteredByMonth } = REGISTER.activeFrom
    const dated = goLiveCount + sum(Object.values(scatteredByMonth))
    const counts = tally(
      registrations,
      (registration) => registration.activeFrom
    )

    const share = (count) => (count / dated) * registrations.length
    // The quota settles its leftover on the largest remainders, so a month
    // lands within one of its share rather than exactly on it.
    near(counts[goLive], share(goLiveCount), 1)

    const scattered = registrations.filter(
      (registration) => registration.activeFrom !== goLive
    )
    const byMonth = tally(scattered, (registration) =>
      registration.activeFrom.slice(0, 7)
    )
    assert.deepEqual(
      Object.keys(byMonth).sort(),
      Object.keys(scatteredByMonth).sort()
    )
    for (const [month, count] of Object.entries(scatteredByMonth)) {
      near(byMonth[month], share(count), 1)
    }
    assert.ok(
      scattered.every((registration) => registration.activeFrom > goLive)
    )
  })

  it('runs every accreditation window from its registration to the end of that year', () => {
    for (const registration of registrations) {
      const accreditation = registration.accreditation
      if (!accreditation) continue

      assert.equal(accreditation.validFrom, registration.activeFrom)
      assert.equal(accreditation.validTo, '2026-12-31')
    }
  })

  /**
   * The register's two cancelled registrations and two cancelled
   * accreditations are the same two rows, so the planner derives one from the
   * other rather than drawing them apart. Asserting both counts here is what
   * holds that reading of the register.
   */
  it('cancels a couple of registrations, each with the accreditation it cancelled', () => {
    const counts = tally(registrations, (registration) => registration.status)

    assert.equal(
      REGISTER.cancelledRegistrations,
      REGISTER.accreditationStatus.cancelled
    )
    assert.equal(counts.cancelled, REGISTER.cancelledRegistrations)
    assert.equal(
      counts.approved,
      REGISTER.registrations - REGISTER.cancelledRegistrations
    )

    for (const registration of registrations) {
      const status = registration.accreditation?.status ?? 'none'
      assert.equal(
        status === 'cancelled',
        registration.status === 'cancelled',
        `${registration.id} is ${registration.status} against a ${status} accreditation`
      )
    }
  })
})

/**
 * What a seed moves is which organisations turn out to hold what, and a few
 * of the estate's totals follow from that: how many rows export rather than
 * reprocess, and so how many rows of each material a type's quota is spread
 * over. Averaging over a spread of seeds is what shows the generator itself
 * sits on the register, rather than one arrangement happening to.
 */
describe('drawn distributions over a spread of seeds', () => {
  const seeds = Array.from({ length: 40 }, (_, index) => `spread-${index}`)
  const plans = seeds.map((seed) => planPopulation({ seed }))
  const perSeed = plans.map((plan) =>
    plan.organisations.flatMap((organisation) => organisation.registrations)
  )
  const meanCount = (read, value) =>
    perSeed.reduce(
      (sum, plan) => sum + plan.filter((row) => read(row) === value).length,
      0
    ) / seeds.length

  it('gives each agency the registrations the register gives it', () => {
    for (const [agency, target] of Object.entries(REGISTER.agencyRows)) {
      near(
        meanCount((row) => row.agency, agency),
        target,
        target * 0.12
      )
    }
  })

  /**
   * Every cell within three percent or half a row, whichever is more, so a
   * one-row material can be short but never absent. The rows of each
   * material are a quota over the rows of its processing type, so what is
   * left to the seed is how many rows that type holds.
   */
  it('registers each material for each processing type as often as the register does', () => {
    for (const [processingType, materials] of Object.entries(
      REGISTER.rowsByTypeAndMaterial
    )) {
      for (const [suffix, target] of Object.entries(materials)) {
        const mean = meanCount(
          (row) =>
            row.processingType === processingType ? row.material.suffix : null,
          suffix
        )

        near(mean, target, Math.max(0.5, target * 0.03))
      }
    }
  })

  it('never registers a material its processing type does not register', () => {
    for (const plan of perSeed) {
      for (const registration of plan) {
        assert.ok(
          REGISTER.rowsByTypeAndMaterial[registration.processingType][
            registration.material.suffix
          ] > 0,
          `${registration.processingType} ${registration.material.suffix}`
        )
      }
    }
  })

  /**
   * The service refuses a second approved registration on the same key: the
   * material for an exporting registration, the material and site for a
   * reprocessing one. So an operator can export plastic once but reprocess it
   * at each of its sites. Every seed and both scales, because one refusal
   * stops a run.
   */
  it('never plans two registrations one operator could not both hold', () => {
    const scales = [1, 0.1]
    for (const scale of scales) {
      for (const seed of seeds) {
        for (const organisation of planPopulation({ seed, scale })
          .organisations) {
          const keys = organisation.registrations.map(
            (registration) =>
              `${registration.processingType} ${registration.material.suffix} ${registration.siteId}`
          )
          assert.equal(
            new Set(keys).size,
            keys.length,
            `${organisation.id} at scale ${scale} of ${seed}: ${keys.join(', ')}`
          )
        }
      }
    }
  })

  it('derives the Annex II process from the material, landing on the register counts', () => {
    for (const [process, target] of Object.entries(registerProcessRows())) {
      near(
        meanCount((row) => row.material.process, process),
        target,
        target * 0.03
      )
    }
  })

  /**
   * An organisation never holds more sites than it has reprocessing
   * registrations, because a site only exists where something is registered at
   * it. That caps the site spread against the register's wherever the type and
   * registration draws leave an organisation too small to carry the sites the
   * quota gave it, so these counts are a mean over the seeds rather than an
   * exact match. An exporting organisation holds no sites, so a site count
   * above zero is a reprocessing organisation.
   */
  it('gives reprocessing organisations the spread of sites the register shows', () => {
    const meanOrganisations = (holding) =>
      plans.reduce(
        (sum, plan) =>
          sum +
          plan.organisations.filter((organisation) =>
            holding(organisation.sites.length)
          ).length,
        0
      ) / seeds.length
    const target = REGISTER.sitesPerReprocessorOrganisation

    near(
      meanOrganisations((count) => count === 1),
      target['1'],
      2
    )
    near(
      meanOrganisations((count) => count === 2),
      target['2'],
      2
    )
    near(
      meanOrganisations((count) => count >= 3),
      target['3'] + target['4'] + target['5'],
      2
    )
  })
})

describe('the shape of what the later planners read', () => {
  it('gives every organisation and registration a stable, distinct identifier', () => {
    const organisationIds = organisations.map((organisation) => organisation.id)
    const registrationIds = registrations.map((registration) => registration.id)

    assert.equal(new Set(organisationIds).size, organisations.length)
    assert.equal(new Set(registrationIds).size, registrations.length)
    assert.equal(organisations[0].id, 'OP-0001')
  })

  const firstRegistrationOf = (suffix) => {
    const found = registrations.find(
      (registration) => registration.material.suffix === suffix
    )
    assert.ok(found, `nothing registered ${suffix}`)
    return found
  }

  it('carries the material as the repo already spells it, not as a bare suffix', () => {
    const plastic = firstRegistrationOf('PL').material

    assert.equal(plastic.material, 'Plastic (R3)')
    assert.equal(plastic.name, 'Plastic')
    assert.equal(plastic.process, 'R3')
  })

  it('tells glass remelt apart from glass other by its recycling process', () => {
    assert.equal(
      firstRegistrationOf('GR').material.glassRecyclingProcess,
      'Glass re-melt'
    )
    assert.equal(
      firstRegistrationOf('GO').material.glassRecyclingProcess,
      'Glass other'
    )
  })

  it('puts every reprocessing registration on a site its organisation holds', () => {
    for (const organisation of organisations) {
      for (const registration of organisation.registrations) {
        if (registration.processingType === 'reprocessor') {
          assert.ok(
            organisation.sites.some((site) => site.id === registration.siteId)
          )
        } else {
          assert.equal(registration.siteId, null)
        }
      }
    }
  })

  it('spreads reprocessing registrations over the sites rather than piling them on one', () => {
    const spread = organisations.filter(
      (organisation) =>
        organisation.sites.length > 1 &&
        organisation.registrations.filter(
          (registration) => registration.processingType === 'reprocessor'
        ).length >= organisation.sites.length
    )

    assert.ok(spread.length > 0, 'no organisation has a site to spread over')
    for (const organisation of spread) {
      const used = new Set(
        organisation.registrations
          .filter(
            (registration) => registration.processingType === 'reprocessor'
          )
          .map((registration) => registration.siteId)
      )

      assert.equal(used.size, organisation.sites.length)
    }
  })

  it('lists exactly the materials its registrations use', () => {
    for (const organisation of organisations) {
      const used = new Set(
        organisation.registrations.map(
          (registration) => registration.material.suffix
        )
      )

      assert.deepEqual([...used].sort(), [...organisation.materials].sort())
    }
  })

  it('gives every organisation a behaviour profile drawn from the named mix', () => {
    assert.ok(
      organisations.every((organisation) =>
        ['punctual', 'typical', 'tardy'].includes(
          organisation.profile.archetype
        )
      )
    )
  })

  /**
   * The README quotes these band averages, so they are held here rather than
   * left to drift out of the prose the other planners read.
   */
  it('scales reporting volume with the tonnage band, averaging one across the estate', () => {
    const meanFactor = (members) =>
      members.reduce(
        (sum, organisation) => sum + organisation.profile.volumeFactor,
        0
      ) / members.length

    near(meanFactor(organisations), 1, 0.1)

    const wholly = (band) =>
      organisations.filter((organisation) => {
        const bands = organisation.registrations.map(
          (registration) => registration.accreditation?.tonnageBand
        )
        return bands.length > 0 && bands.every((held) => held === band)
      })

    near(meanFactor(wholly('Over 10,000 tonnes')), 2, 0.3)
    near(meanFactor(wholly('Up to 10,000 tonnes')), 1, 0.3)
    near(meanFactor(wholly('Up to 5,000 tonnes')), 0.5, 0.2)
    near(meanFactor(wholly('Up to 500 tonnes')), 0.15, 0.1)
  })

  it('records the settings it was planned with', () => {
    assert.equal(population.seed, 'register')
    assert.equal(population.scale, 1)
    assert.equal(population.profileMix, 'production')
  })
})

describe('planning is reproducible', () => {
  it('gives the same population for the same seed', () => {
    const first = planPopulation({ seed: 'repeatable' })
    const second = planPopulation({ seed: 'repeatable' })

    assert.deepEqual(first, second)
  })

  it('does not let an edited population reach into the next one', () => {
    const first = planPopulation({ seed: 'isolated' })
    first.organisations[0].registrations[0].material.name = 'Tampered'

    assert.notEqual(
      planPopulation({ seed: 'isolated' }).organisations[0].registrations[0]
        .material.name,
      'Tampered'
    )
  })

  it('gives a different population for a different seed', () => {
    const first = planPopulation({ seed: 'one' })
    const second = planPopulation({ seed: 'two' })

    assert.notDeepEqual(first, second)
  })

  it('is unaffected by the order callers plan other populations in', () => {
    const expected = planPopulation({ seed: 'steady' })

    planPopulation({ seed: 'noise', scale: 0.3 })
    planPopulation({ seed: 'more-noise', profileMix: 'chaotic' })

    assert.deepEqual(planPopulation({ seed: 'steady' }), expected)
  })
})

describe('scaling the run down', () => {
  const scale = 0.1
  const tenth = planPopulation({ seed: 'register', scale })

  it('keeps the organisation and registration counts in proportion', () => {
    assert.equal(
      tenth.organisations.length,
      Math.round(REGISTER.organisations * scale)
    )
    near(
      tenth.organisations.flatMap((organisation) => organisation.registrations)
        .length,
      REGISTER.registrations * scale,
      4
    )
  })

  it('still has every kind of organisation in it', () => {
    assert.deepEqual(
      new Set(tenth.organisations.map((organisation) => organisation.type)),
      new Set(['exporter', 'reprocessor', 'both'])
    )
  })

  /**
   * A status the register carries twice in 389 rounds away to nothing at this
   * scale, which would leave a local run with no suspension or cancellation to
   * walk through. Every seed, not a lucky one, so this runs over a spread.
   */
  it('still carries every accreditation status the register does', () => {
    for (let seed = 0; seed < 8; seed++) {
      const statuses = new Set(
        planPopulation({ seed: `tenth-${seed}`, scale })
          .organisations.flatMap((organisation) => organisation.registrations)
          .map((registration) => registration.accreditation?.status ?? 'none')
      )

      assert.deepEqual(
        statuses,
        new Set(Object.keys(REGISTER.accreditationStatus)),
        `seed ${seed} planned ${[...statuses].join(', ')}`
      )
    }
  })

  it('plans a single organisation without falling over', () => {
    const one = planPopulation({ seed: 'tiny', scale: 1 / 293 })

    assert.equal(one.organisations.length, 1)
    assert.ok(one.organisations[0].registrations.length >= 1)
  })

  it('refuses a scale that would plan nobody', () => {
    assert.throws(() => planPopulation({ scale: 0 }), /above zero/)
    assert.throws(() => planPopulation({ scale: -1 }), /above zero/)
  })
})

describe('choosing a profile mix', () => {
  it('uses the named mix rather than the production default', () => {
    const chaotic = planPopulation({ seed: 'register', profileMix: 'chaotic' })
    const tardyShare = (plan) =>
      plan.organisations.filter(
        (organisation) => organisation.profile.archetype === 'tardy'
      ).length / plan.organisations.length

    assert.equal(chaotic.profileMix, 'chaotic')
    assert.ok(tardyShare(chaotic) > tardyShare(population))
  })

  it('refuses a mix it does not know', () => {
    assert.throws(
      () => planPopulation({ seed: 'register', profileMix: 'sloppy' }),
      /sloppy/
    )
  })
})

describe('planning against a supplied calibration', () => {
  /**
   * The planner holds no figures of its own, so a run given a different
   * register plans a different estate. That is the seam a calibration measured
   * against production arrives through.
   */
  const smaller = {
    ...DEFAULT_CALIBRATION,
    register: {
      ...REGISTER,
      organisations: 40,
      registrations: 40,
      organisationType: { exporter: 40, reprocessor: 0, both: 0 },
      registrationsPerOrganisation: { 1: 40 },
      materialsPerOrganisation: { 1: 40 },
      agencyRows: { SEPA: 40 },
      activeFrom: { ...REGISTER.activeFrom, goLiveCount: 30 }
    }
  }

  it('plans the register it was handed rather than the shipped one', () => {
    const plan = planPopulation({ seed: 'supplied', calibration: smaller })

    assert.equal(plan.organisations.length, 40)
    assert.ok(
      plan.organisations.every(
        (organisation) =>
          organisation.type === 'exporter' && organisation.agency === 'SEPA'
      )
    )
  })

  it('draws behaviour from the calibration it was handed too', () => {
    const idle = {
      ...DEFAULT_CALIBRATION,
      activity: {
        ...DEFAULT_CALIBRATION.activity,
        uploads: { ...DEFAULT_CALIBRATION.activity.uploads, rejectionRate: 0 }
      }
    }
    const plan = planPopulation({ seed: 'supplied', calibration: idle })

    assert.ok(
      plan.organisations.every(
        (organisation) => organisation.profile.uploads.rejectionRate === 0
      )
    )
  })

  /**
   * Putting the rarities back takes rows off the commonest status, and the
   * smallest runs have barely any to take. A run with nothing approved has
   * nothing to report against or raise a note from, which is every use the
   * simulator has.
   */
  it('keeps an approved accreditation however small the run', () => {
    for (let scale = 1; scale <= 12; scale++) {
      const plan = planPopulation({
        seed: `small-${scale}`,
        scale: scale / REGISTER.organisations
      })
      const accreditations = plan.organisations
        .flatMap((organisation) => organisation.registrations)
        .map((registration) => registration.accreditation)

      assert.ok(
        accreditations.some(
          (accreditation) => accreditation?.status === 'approved'
        ),
        `a ${scale}-organisation run planned nothing approved`
      )
    }
  })

  /**
   * Two exporters of two materials each over plastic twice, paper once and
   * glass once: whichever draws first can take paper and glass together and
   * leave the other two rows of plastic it cannot hold, which one seed in a
   * few does. The rows are dealt again rather than the calibration refused.
   */
  it('deals the rows again when an earlier draw leaves a later organisation nothing it can take', () => {
    const tight = {
      ...DEFAULT_CALIBRATION,
      register: {
        ...REGISTER,
        organisations: 2,
        registrations: 4,
        organisationType: { exporter: 2, reprocessor: 0, both: 0 },
        registrationsPerOrganisation: { 2: 2 },
        materialsPerOrganisation: { 2: 2 },
        rowsByTypeAndMaterial: { exporter: { PL: 2, PA: 1, GR: 1 } }
      }
    }

    for (let seed = 0; seed < 20; seed++) {
      const plan = planPopulation({ seed: `tight-${seed}`, calibration: tight })
      for (const organisation of plan.organisations) {
        assert.equal(organisation.materials.length, 2, `seed ${seed}`)
      }
    }
  })

  it('refuses a shape the materials it registers cannot hold', () => {
    const twoMaterials = {
      ...DEFAULT_CALIBRATION,
      register: {
        ...REGISTER,
        organisations: 4,
        registrations: 12,
        organisationType: { exporter: 4, reprocessor: 0, both: 0 },
        registrationsPerOrganisation: { 3: 4 },
        materialsPerOrganisation: { 3: 4 },
        rowsByTypeAndMaterial: { exporter: { PL: 8, PA: 4 } }
      }
    }

    assert.throws(
      () => planPopulation({ seed: 'narrow', calibration: twoMaterials }),
      /cannot hold 3 materials across 3 exporter registrations on 0 sites/
    )
  })

  it('plans no status the calibration gives no registrations to', () => {
    const settled = {
      ...DEFAULT_CALIBRATION,
      register: {
        ...REGISTER,
        accreditationStatus: {
          approved: 387,
          none: 2,
          cancelled: 0,
          suspended: 0
        }
      }
    }
    const plan = planPopulation({ seed: 'settled', calibration: settled })
    const statuses = new Set(
      plan.organisations
        .flatMap((organisation) => organisation.registrations)
        .map((registration) => registration.accreditation?.status ?? 'none')
    )

    assert.deepEqual([...statuses].sort(), ['approved', 'none'])
  })

  /**
   * An agency the calibration registers rows against but never names a nation
   * for otherwise plans a whole estate whose nation is undefined, and says so
   * nowhere until something downstream reads it.
   */
  it('refuses an agency it has no nation for', () => {
    assert.throws(
      () =>
        planPopulation({
          calibration: {
            ...DEFAULT_CALIBRATION,
            register: { ...REGISTER, agencyRows: { EA: 200, XYZ: 189 } }
          }
        }),
      /"XYZ".*no nation/
    )
  })
})
