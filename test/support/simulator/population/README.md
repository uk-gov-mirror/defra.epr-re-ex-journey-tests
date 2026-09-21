# Operator population

Plans the operators a simulator run will create, and the behaviour profile each
one works to. Pure and seeded: nothing here calls an API, reads a clock or
touches the filesystem, and the same settings always give the same population.

```js
import { planPopulation } from './population.js'

const population = planPopulation({ seed: 'run-42', scale: 0.1 })
```

Import it by a relative path. The `~` alias the specs use comes from a loader
only the Playwright scripts pass, and these modules run under `npm run
test:unit`, which is plain Node.

| Setting       | Default               | What it does                                                                                                                                          |
| ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed`        | `'pepr'`              | Anything that stringifies. The same seed always replays the same population.                                                                          |
| `scale`       | `1`                   | `1` is the whole register the calibration describes, which by default is 293 operators holding 389 registrations. `0.1` gives a tenth, in proportion. |
| `profileMix`  | `'production'`        | Which behaviour mix the estate is drawn from.                                                                                                         |
| `calibration` | `DEFAULT_CALIBRATION` | Every figure the plan is built from. See "Where the numbers come from".                                                                               |

## What comes back

```js
{
  seed, scale, profileMix,
  organisations: [ /* PlannedOperator */ ]
}
```

An operator is one organisation on the register.

| Field           | Meaning                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`            | `OP-0001`. Stable for a given seed and scale.                                                                         |
| `type`          | `exporter`, `reprocessor` or `both`.                                                                                  |
| `agency`        | `EA`, `NIEA`, `NRW` or `SEPA`.                                                                                        |
| `nation`        | The nation that agency regulates.                                                                                     |
| `materials`     | The material suffixes it registers, sorted. `PL`, `PA`, `GR`, `GO`, `AL`, `ST`, `WO`, `FB`.                           |
| `sites`         | `{ id }` per reprocessing site. Empty for an exporting-only operator. Every site has at least one registration on it. |
| `registrations` | One per registered material and processing type, and per site for a reprocessor.                                      |
| `profile`       | How it behaves. See below.                                                                                            |

A registration:

| Field            | Meaning                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | `OP-0001-R1`.                                                                                                                                    |
| `organisationId` | The operator it belongs to.                                                                                                                      |
| `processingType` | `exporter` or `reprocessor`. Input against output is the row planner's business, not this one's.                                                 |
| `material`       | The whole entry from `test/support/materials.js`, so `material`, `suffix`, `name`, `prnName`, `process` and, for glass, `glassRecyclingProcess`. |
| `siteId`         | Which of the operator's sites it reprocesses at. `null` for an exporting registration.                                                           |
| `status`         | `approved`, or `cancelled` for the couple the register carries.                                                                                  |
| `activeFrom`     | ISO date. Most are the first day of 2026; the rest fall in the month the register dates them to.                                                 |
| `accreditation`  | `null` where the operator is registered but not accredited. Twenty of the 389 are.                                                               |

An accreditation carries `status` (`approved`, `suspended` or `cancelled`), its
`tonnageBand` as the application form spells it, and the window it covers as
`validFrom` and `validTo`. The window opens the day the registration did and
runs to the end of that accreditation year. A registration is cancelled exactly
where its accreditation is: the register's two of each are the same two rows.

A status is where the operator ended up, not when it got there. Nothing here
says the day an accreditation was suspended or a registration cancelled, so the
event calendar decides that and replays the year up to the state planned here.

## The behaviour profile

Every operator carries one. It is the disposition; the planners own the events.
Read a rate as the probability to draw against per return, per upload or per
PRN, so two operators on the same archetype still behave differently over a
year.

| Field           | What it means                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archetype`     | Which of `punctual`, `typical` or `tardy` this operator draws its rates from.                                                                                                |
| `volumeFactor`  | How much it reports and issues against the estate average of 1. Comes from its tonnage bands, then varies by up to 40% either way. Multiply the calibrated base rates by it. |
| `worksWeekends` | Whether it uploads and issues on a Saturday or Sunday at all.                                                                                                                |

Turning a tonnage band into a volume factor is a judgement, and it is the
largest one in here. An operator over 10,000 tonnes comes out around 2.0 against
0.15 for one up to 500, so roughly 13 to 1 across bands spanning 20 to 1 in
tonnage. A bigger operator issues bigger PRNs as much as more of them, so the
count grows more slowly than the tonnage does. `tonnageBandPrnWeight` on the
calibration is where to argue with that.

Every rate below is the calibrated one spread across the three archetypes, so
what an individual operator carries depends on which archetype it drew. Under
the `production` mix the estate average comes back to the calibration exactly.
Read the calibration for the values; read this for what each one means.

**Reporting**, drawn per report. A report is the per-period aggregation, not the
summary log upload that triggers one: an upload answers no calendar, so its
punctuality is not here and nothing published measures it. The four punctuality
shares always add to one.

| Field                        | What it means                                                        |
| ---------------------------- | -------------------------------------------------------------------- |
| `reporting.onTime`           | Filed by the 21st of the month after the period.                     |
| `reporting.earlyShare`       | Of the on-time ones, the share filed more than ten days early.       |
| `reporting.lateWithin7`      | Up to a week late.                                                   |
| `reporting.lateWithin30`     | Up to a month late.                                                  |
| `reporting.lateBeyond30`     | More than a month late.                                              |
| `reporting.missedReturnRate` | Reports that never arrive at all.                                    |
| `reporting.restatementRate`  | How often it reopens a period it has already closed and files again. |

**Uploads**, drawn per summary log upload. An upload answers no calendar, so
its behaviour is a rate rather than a punctuality: how many uploads a period
gets, and what becomes of each.

| Field                               | What it means                                                            |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `uploads.perReportingPeriod`        | Uploads a registration makes per reporting period, whatever its cadence. |
| `uploads.rejectionRate`             | How often a spreadsheet comes back with validation issues.               |
| `uploads.fatalShare`                | Of those, the share that are fatal rather than errors on rows.           |
| `uploads.extraAttemptsWhenRejected` | How many more goes it takes before the upload lands: 1, or 2 when tardy. |
| `uploads.abandonRate`               | How often it walks away from a saved draft instead of submitting.        |

**PRNs**, drawn per PRN.

| Field                          | What it means                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `prn.deleteRate`               | Deleted after being raised for authorisation.                                          |
| `prn.discardRate`              | Discarded while still a draft.                                                         |
| `prn.cancelRate`               | The producer asks for it to be cancelled instead of accepting it, and it is.           |
| `prn.producerAcceptRate`       | How often the producer accepts rather than leaving it sitting.                         |
| `prn.sameMonthAcceptanceShare` | Of those accepted, the share accepted in the month it was issued rather than the next. |

How many PRNs an operator issues is not on the profile. The estate rate is
`activity.prnsPerAccreditationPerMonth` on the calibration; multiply it by
the operator's `volumeFactor`. Rows per summary log submission work the same
way, from `activity.rowsPerSubmission`.

### Profile mixes

| Mix          | Use it for                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `production` | The default. The estate means land exactly on the calibration the archetypes were built from.                          |
| `punctual`   | A clean run: everything on time, few rejections, nothing abandoned.                                                    |
| `chaotic`    | Leaning on the defect paths: rejected uploads, abandoned drafts, late and missing returns, deleted and cancelled PRNs. |

## Where the numbers come from

The planners hold no figures of their own. `planPopulation` reads everything off
the calibration it is given, and `DEFAULT_CALIBRATION` in `calibration.js` is
what it uses when it is given none.

That default is built from the pEPR public register of 10 September 2026 alone.
Its counts are read straight off the register. Punctuality, the weekend share of
uploads and the missed-return rate are computed from the register's own
report dates. Everything else is a nominal placeholder, round enough to read
as one, because nothing published measures how a spreadsheet upload fares, how
often a return is restated, or what becomes of a PRN once it is raised. Each
figure says which it is where it stands.

### Running against measured behaviour

Point `SIMULATOR_CALIBRATION` at a JSON file and `loadCalibration()` lays it
over the defaults:

```js
import { loadCalibration } from './calibration.js'
import { planPopulation } from './population.js'

planPopulation({ seed: 'run-42', calibration: loadCalibration() })
```

The file holds only the settings it changes, nested as the calibration is. It
may not introduce a setting the defaults do not already carry, and may not
change one's type, so a misspelling is refused rather than leaving a run
quietly on the defaults. That holds inside the count maps too, so an overlay
can reweight an agency or a tonnage band but cannot add one. The one exception
is a worksheet's `monthlyTonnage`: the defaults carry it only where the monthly
aggregated workbook publishes a figure, so an overlay may add it, as a number,
to a worksheet that has none. The row planner refuses it on a worksheet whose
rows carry no load, since no row could report it; which worksheets those are
is the sheet table's to say. A calibration that needs a shape the register does not have is
passed to `planPopulation` directly instead. Such a file is never committed.

The planner does not call `loadCalibration` itself, so planning stays pure and a
seed replays the same population whether or not a machine has the overlay. The
caller decides.

Anything the register gives as a count is handed out as a quota and then
shuffled. That puts organisation type, registrations per operator,
accreditation status, tonnage band and the go-live share exactly on the
register at full scale, and keeps them in proportion at a tenth.

A seed varies the arrangement rather than the quotas. Each count is worked out
from the distribution and the total, the rounding leftover included, so every
seed at a given scale hands out the same numbers and changes only which
operator gets which. That is what makes a calibration true of every run instead
of the average one, and it is not what a seeded generator usually gives: more
seeds will not show a differently shaped estate, only a differently arranged
one.

Active dates are quotas by month rather than one window drawn across evenly.
The register's own dates thin out from a January tail and run to September, and
the simulator counts monthly returns from this date, so an evenly drawn one
would hand a registration returns it never owed.

The service approves one exporting registration per material on an operator,
and one reprocessing registration per material and site, so the plan holds to
that: an operator exports each of its materials at most once and reprocesses
each at most once per site, with the rows of one material spread over its
sites. That puts a floor under how many materials an operator needs, and the
floors are what keeps the material spread near rather than exactly on the
register. An exporter holds a material per registration, so a seed that draws
more multi-registration exporters than the register has moves a few operators
up a bucket. The "both" operators go on the two-registration organisations
first, because an operator exporting and reprocessing one material is most of
what the register's are.

The rows of each material are a quota too, one per processing type over the
rows the plan holds of that type, and each operator takes its rows out of
that pool in one draw: every row from what is left for its processing type,
redrawn until the rows between them hold exactly the distinct materials the
register gave the operator and no more of one material than the service
approves. The operators with the most rows draw first, while the pool still
holds every shape, and an operator that finds no shape in what is left hands
the whole estate's rows back to be dealt again. Taking the rows from a pool
is what holds the material row totals whatever the operators' shapes ask of
them.

The site spread is near rather than exact, because an operator is held to the
sites it has the registrations to carry: it shifts by an organisation or two,
leaving the estate a few sites short of the register's 176.
`population.test.js` states the tolerance on each.

A status the register carries only twice would round away to nothing on a small
run, so every accreditation status gets at least one registration wherever
there are registrations to spare. A tenth-scale run still has a suspension and
a cancellation to walk through.
