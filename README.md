epr-re-ex-journey-tests

The consolidated Playwright journey-test suite for the Re/Ex service line, exercising
`epr-frontend`, `epr-backend`, and `epr-re-ex-admin-frontend` together against
one shared backing-services stack (mongodb, redis, floci, cognito-stub,
defra-id-stub, epr-re-ex-entra-stub). This repo replaces three previously
separate journey-test repos, one per app.

- [Local](#local)
  - [Requirements](#requirements)
    - [Node.js](#nodejs)
    - [Gitleaks](#gitleaks)
    - [Mise](#mise)
  - [Setup](#setup)
  - [Running local tests](#running-local-tests)
  - [Writing a spec](#writing-a-spec)
  - [Running with Proxy](#running-with-proxy)
  - [Feature flags in journey tests](#feature-flags-in-journey-tests)
  - [Generating test organisation data](#generating-test-organisation-data)
  - [Generating summary-log spreadsheets](#generating-summary-log-spreadsheets)
  - [Seeding organisations with an uploaded summary log](#seeding-organisations-with-an-uploaded-summary-log)
  - [Simulating a year of operator activity](#simulating-a-year-of-operator-activity)
  - [Debugging local tests](#debugging-local-tests)
- [Production](#production)
  - [Running tests with Profile](#running-tests-with-profile)
  - [Choosing stub or real identity providers](#choosing-stub-or-real-identity-providers)
- [Requirements of CDP Environment Tests](#requirements-of-cdp-environment-tests)
- [Running on GitHub](#running-on-github)
- [BrowserStack](#browserstack)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Local Development

### Requirements

#### Node.js

Please install [Node.js](http://nodejs.org/) `>= v20` and [npm](https://nodejs.org/) `>= v9`. You will find it
easier to use the Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
nvm use
```

#### Gitleaks

[Gitleaks](https://github.com/gitleaks/gitleaks) is required for pre-commit secret scanning and must be available on your PATH.

The simplest install on macOS/Linux is via [mise](#mise)

```bash
mise trust && mise install
```

Alternatively, install directly:

- macOS: `brew install gitleaks`
- Linux/Windows: see the [gitleaks releases page](https://github.com/gitleaks/gitleaks/releases)

#### Mise

[mise](https://mise.jdx.dev/) - a polyglot version manager that reads `mise.toml` in this repo to install the correct pinned versions

1. [Install](https://mise.jdx.dev/getting-started.html#installing-mise-cli)
2. [Activate](https://mise.jdx.dev/getting-started.html#activate-mise) in your shell

### Setup

Install application dependencies:

```bash
npm install
```

### Running local tests

Bring up the three apps under test and their backing services with `docker compose up -d --build` (see [Running on GitHub](#running-on-github) below for what `compose.yml` provides), then:

```bash
npm run test:local
```

Running tests with a specific tag locally - for example, a frontend PRN spec or an admin spec:

```bash
GREP='@delPRNExp' npm run test:local:grep
GREP='@tonnageMonitoring' npm run test:local:grep
```

**Tag conventions:**

Tags are for `--grep` spec selection, not documentation. Every tag is camelCase (`@newTag`, not `@newtag` or `@new-tag`; a single-word tag like `@cma` is just lowercase). A handful of tags are additionally cross-cutting categories with an enforced meaning - use those to select a slice of the suite by concern, and hold any new one to the same bar: does it name a concern broad enough to span multiple spec files, or is it really a label for one spec?

- `@smoketest` - broad, high-value specs (real S3/CDP Uploader exercise, wide page traversal across an app variant) worth running everywhere: locally, in GHA, and as the CDP Portal's default profile against a real environment. Reserve it for breadth/infra-relevance, not for re-proving business logic already covered by an ordinary spec - that just slows down every run without adding signal.
- `@organisations` - admin-app specs that operate on an organisation as an admin-facing entity: viewing/updating it, its registrations and submissions, and linking/unlinking its Defra ID. Not for regulator-side or applicant-facing organisation views - use `@regulator` there.
- `@regulator` - specs exercising the regulator frontend: login, browsing/searching organisations, reading registrations and accreditations, and regulator-side permission boundaries. Everything under `specs/regulator/` should carry it.
- `@cma` - specs covering closed-period adjustments surfaced in summary logs and reports: adjusted-load detection, the associated messaging, and resubmission behaviour once a period has closed.
- `@extTestOnly` - specs that only work against the ext-test environment, typically because they sign in through a real, non-stubbed identity provider that's only wired up there (see the Defra ID note in `test/config/config.js`). These still guard themselves with a runtime `test.skip` keyed off `process.env.ENVIRONMENT`, so an accidental run elsewhere skips rather than fails - the tag is for selecting or excluding this slice by concern (e.g. `GREP='@extTestOnly'`), not a substitute for the runtime guard.

Everything else you'll see in a test title (`@delPRNExp`, `@summaryLogExporter`, `@registrationTransitions`, ...) is a free-form, per-spec grep handle, not a category: `--grep` matches title text, so a short unique word lets you target one spec or scenario (see the `GREP=` examples above) without needing to type its full sentence. Beyond the shared camelCase rule, these aren't standardized - they aren't guaranteed to mean anything outside their own file, and shouldn't be used to select CI runs by concern - only the category tags above are held to that bar. `@admin` used to be one of these masquerading as a category (tagging 2 of the many specs under `specs/admin/`, duplicating what the path-based `test:local:admin` script already selects); it's been retired rather than fixed, since nothing needed the extra selector once you had the path.

### Writing a spec

Before you add a spec, check that the test belongs here. [Where a Test Goes](https://github.com/DEFRA/epr-re-ex-service/blob/main/docs/testing/0002-test-coverage.md) says what belongs in the journey tests and what belongs in the service repos.

A journey test earns its confidence by resembling what a user does. A spec that reaches past the user, to a test id, a deep link or a URL check, can pass while the user is stuck: the button is mislabelled, the link is missing, the page at the right address is an error. So a spec reads like the user's story: land on an entry page, follow the links and buttons, and check what the page now shows, using Playwright's user-facing locators (`getByRole`, `getByLabel`, `getByText`).

**Find elements by what the user perceives.** Role and accessible name first: `getByRole('button', { name: 'Continue' })`, `getByRole('link', { name: 'Reports' })`, `getByRole('heading', { name: 'Upload your summary log' })`. Then `getByLabel` for a form field and `getByText` for other visible text. Reach for a `data-testid`, an id, a `govuk-*` class or an `nth-child` only when no user-facing query can express the target. A role query that finds nothing usually means a screen reader user could not find it either, so raise it with the app that owns the page rather than write the selector. The bar applies wherever the locator lives, page objects included.

**Check a page's accessibility in a journey that visits it.** Call `checkAccessibility(page, '<page name>')` from `test/support/accessibility.js` once the page has rendered. It runs an axe scan and fails the journey on any Serious or Critical violation. One journey per page is enough; prefer a `@smoketest` journey where one reaches the page, so the check also runs against real environments. The smoke test run, `npm run test:smoketest`, sets `RUN_LIGHTHOUSE=true`, which makes each check also run a Lighthouse audit of the page and attach its report to Allure. The pull request runs leave it off.

**Navigate the way the user does.** Open the entry page, then click through. A `page.goto` deep into a journey skips the journey the spec claims to cover; keep it for the entry point and for a page the user would genuinely reach by URL.

**Assert on what the user sees.** The heading of the page you arrived on, the row in the table, the error message, the confirmation panel. Not the URL, not a cookie, not a data attribute. Assert a URL only when the URL is itself the user-facing thing, such as a page they would bookmark or be sent a link to.

**Wait for user-visible state.** `await expect(locator).toBeVisible()` on the heading or message you expect, not `waitForURL` or a network response.

```js
// reaches past the user
await page.goto(`/registrations/${regId}/summary-logs/upload`)
await page.locator('#summary-log-upload').setInputFiles(filePath)
await page.locator('button[type=submit]').click()
await expect(page).toHaveURL(/\/summary-logs\/check/)

// what the user does and sees
await page.getByRole('link', { name: 'Upload your summary log' }).click()
await page.getByLabel('Choose XLSX file').setInputFiles(filePath)
await page.getByRole('button', { name: 'Continue' }).click()
await expect(
  page.getByRole('heading', { name: 'Your summary log is being checked' })
).toBeVisible()
```

### Running with Proxy

By default, running via a MITM proxy is disabled. To inspect the API traffic these tests generate, first start an [mitmproxy](https://mitmproxy.org/) container **on the `cdp-tenant` docker network** - mitmproxy resolves the target hostname of a proxied request itself, from inside that network, so it needs to be able to see `epr-backend`, `defra-id-stub`, `entra-stub`, and `cognito-stub` by name. `compose.yml` attaches every backing-services container to `cdp-tenant` for exactly this reason:

```bash
docker run --rm -it --name mitm-proxy --network cdp-tenant -p 7777:7777 -p 127.0.0.1:8081:8081 mitmproxy/mitmproxy mitmweb --web-host 0.0.0.0 --listen-port 7777 --set block_global=false
```

You can now monitor the proxy traffic via <http://localhost:8081/> (use the token from the console output of the command above).

If you wish to use a port other than 8081 for the mitmproxy web UI, pass in the following option at the end of the docker command (e.g. port 8082):

```bash
--web-port 8082
```

Now, run the tests with:

```bash
WITH_PROXY=true npm run test:local
```

The default proxy port is 7777. You can point at a different proxy (e.g. one already running elsewhere) by setting `HTTP_PROXY` instead - no code change needed:

```bash
WITH_PROXY=true HTTP_PROXY=http://localhost:8888 npm run test:local
```

### Running with ZAP (passive security scan)

[OWASP ZAP](https://www.zaproxy.org/) can sit in front of the browser as a passive-scanning proxy. The journeys do the sign-in and click through every page, so ZAP sees all the authenticated pages that its own spider can't get to. Passive scanning only inspects the traffic going through it and never sends requests of its own, so it doesn't change any test data or the test results.

Start ZAP alongside the local stack (it's behind a compose profile, so a plain `docker compose up` won't start it):

```bash
docker compose --profile zap up -d --wait zap
```

Then run the journeys through it:

```bash
npm run test:zap
# or a subset, e.g.
npm run test:zap -- --grep @smoketest
```

When the run finishes, the suite waits for ZAP's passive scan to drain, then writes `zap-report/zap-report.html` and `zap-report/zap-alerts.json`. It also adds a **Security › ZAP › ZAP passive scan** result to the Allure report with both files attached. That result is marked failed if there are any High-risk alerts against epr-frontend (`localhost:3000`) or the admin frontend (`localhost:3002`). Alerts on the stubs are left out. The Playwright run's exit code is unaffected.

Each run starts a fresh ZAP session, so the ZAP container can stay up between runs. Only the browser goes through ZAP: the suite's direct API/seeding calls don't (unless `WITH_PROXY` is also set), and neither do the frontends' server-side calls to epr-backend.

ZAP uses host networking because the browser targets `localhost`. That works on Linux and in CI, but on Docker Desktop host networking has to be turned on in its settings.

### Feature flags in journey tests

**`compose.yml` is the single source of flag state.** Each `FEATURE_FLAG_*` env
var defaults in `compose.yml` (for example `${FEATURE_FLAG_X:-true}`), and the
suite runs and asserts that one configured state unconditionally. Nothing else
sets flags in CI: the `run-journey-tests` action takes no flag inputs, so every
caller (this repo's PR checks and the `epr-frontend`/`epr-backend`/
`epr-re-ex-admin-frontend` PR checks alike) exercises the same state and
cannot drift. Note the interpolation default only fires while the env var is
unset, so do not export `FEATURE_FLAG_*` vars in workflow env blocks.

Most flags stop there. An in-flight feature is typically tested flag-on in CI
(ahead of the production flip) while the flag-off gating is covered by the
service's own unit and integration tests. When the flag flips on in production
and is later retired, the journey suite needs no changes beyond eventually
dropping the env var from `compose.yml`.

**Named matrix passes are the escalation, not the default.**
`check-pull-request.yml` runs the suite once per named entry in
`matrix.include`. A permanent `baseline` entry runs the `compose.yml` defaults.
If a flag's two states both genuinely warrant journey coverage (a risky or
long-lived divergence, not just new messaging), give it a matrix entry that pins
the non-default state, plumb the value through to the relevant app container(s)
and the runner, and branch the affected specs on it. Cost is linear (`N + 1`
passes for `N` overridden flags). Reach for this deliberately: most flags do
not earn it.

The plumbing, when a flag earns it: add an action input for the flag, have the
action's first step write it once to `$GITHUB_ENV`
(`echo "FEATURE_FLAG_X=${{ inputs.feature-flag-x }}" >> "$GITHUB_ENV"`) so the
same value reaches both the relevant app container (via `compose.yml`
interpolation) and the Playwright runner (via `process.env`), then pass
`${{ matrix.x || '<default>' }}` from the matrix step. Read the env var in one
shared `test/support/flags.js` and branch specs on `flags.x`, for example
letting the flag pick the assertion verb:
`const assert = flags.x ? checkBodyText : checkBodyTextDoesNotInclude`. Once
the flag is retired, delete the matrix entry and this plumbing - `baseline`
stays put.

**The required check is a gate job.** Branch protection requires the exact name
`Run Journey Tests`, which a matrix leg (`Run Journey Tests (<name>)`) can never
match. So an aggregate job named `Run Journey Tests` `needs` the legs and passes
only if all of them did (`if: always()`, so a failed leg fails the gate rather
than skipping it). Its fixed name keeps branch protection decoupled from the
matrix contents: adding or retiring an entry edits only `matrix.include`.

### Generating test organisation data

This only applies to local builds. `test/support/data-generator/` (ported
from `epr-backend-journey-tests`) contains scripts that generate mock
approved Organisation, Registration and Accreditation records directly via
the API - useful for populating a local environment with data to explore
manually, outside of the automated test suite.

You can generate 5 organisation details, registrations and accreditations
(all linked together, using a single random material) in one go with this
command:

```bash
npm run generatedata
```

If you want to generate an organisation that has all materials (but varied
waste processing types, like Reprocessor Input / Output / Exporter), you can
run:

```bash
npm run generatedata:allMaterials
```

If you want to generate organisations that have all materials and all waste
processing types (like Reprocessor Input / Output / Exporter in a single
Organisation), you can run:

```bash
npm run generatedata:allMaterialsMixed
```

To generate with user linking (this assumes you have Defra ID Stub and Entra
Stub running locally):

```bash
npm run generatedata:withLinking
npm run generatedata:allMaterials:withLinking
npm run generatedata:allMaterialsMixed:withLinking
```

This will create mock approved Organisation datasets with linked users. Only
to be used for local development purposes.

### Generating summary-log spreadsheets

`test/support/spreadsheet/` (ported from `epr-backend-journey-tests`) is a
built-in generator that can be used to generate a spreadsheet for Summary
Logs, on demand, instead of relying only on static fixtures under
`test/fixtures/`. It fills a real committed template from
`resources/templates/` with N rows of randomised-but-valid data, giving exact,
controlled row counts/content for a new test rather than searching for (or
hand-editing) a fixture that happens to already have the right shape. It's a
standalone module today - no spec currently calls it - available for
authoring new summary-log tests that need this.

Five generators are available, one per waste-processing type:

```bash
npm run generate:spreadsheet:output              # Reprocessor Output
npm run generate:spreadsheet:input                # Reprocessor Input
npm run generate:spreadsheet:exporter              # Exporter
npm run generate:spreadsheet:regOnlyExporter       # Registered Only (Unaccredited) Exporter
npm run generate:spreadsheet:regOnlyReprocessor    # Registered Only (Unaccredited) Reprocessor
```

You can also pass in registration number, accreditation number, material and
number of rows to generate via environment variables. For example, to
generate 20 rows of Reprocessor Output for Steel with a specific registration
and accreditation number:

```bash
ROWS=20 MATERIAL=ST REG_NUMBER=reg-number-123 ACC_NUMBER=acc-number-123 npm run generate:spreadsheet:output
```

`MATERIAL` is one of the suffixes in `shared-spreadsheet-values.js`'s
`MATERIALS`: Aluminium is `AL`, Fibre-based composite is `FB`, Glass is `GR`
(Re-melt) or `GO` (Other), Paper or board is `PA`, Plastic is `PL`, Steel is
`ST`, Wood is `WO`. Random if omitted.

To dynamically populate the spreadsheet, use the `SHEETS` environment
variable (0-indexed, Cover sheet doesn't count) to specify which sheets to
populate according to their index. For example, with Reprocessor Output, to
populate only the first sheet (Received) and leave the others empty:

```bash
SHEETS=0 ROWS=5 npm run generate:spreadsheet:output
```

To populate the first and third sheets (Reprocessor Input example) only:

```bash
SHEETS=0,2 npm run generate:spreadsheet:input
```

You do not need to pass in an accreditation number for Registered Only
spreadsheets, since it wouldn't be used.

To append more rows onto an existing generated spreadsheet, use the
`FILENAME` environment variable to specify the file and `ROW_OFFSET` to
specify how many rows to offset the new rows from. For example, for a
previous spreadsheet that already has 10 rows generated, append 10 more:

```bash
FILENAME=./data/filename.xlsx ROW_OFFSET=10 ROWS=10 MATERIAL=AL REG_NUMBER=R25SR500000912AL ACC_NUMBER=ACC123456 npm run generate:spreadsheet:input
```

Generated files are written to `data/` (gitignored - transient output only;
`resources/templates/` holds the committed source templates, not `data/`).

### Seeding organisations with an uploaded summary log

This only applies to local builds. Most of the suite submits summary logs
through the backend's dev route, which takes the content as JSON and so leaves
no workbook for the service to offer as a download. To explore a local stack
by hand with summary logs that were uploaded as real workbooks through
cdp-uploader, run:

```bash
GREP='@summaryLogScenarios' npm run test:localonly:grep
```

This seeds one approved organisation, with a linked Defra ID user and a
submitted summary log, for each of: Registered Only Exporter, Registered Only
Reprocessor, Accredited Exporter, Accredited Reprocessor on Input and
Accredited Reprocessor on Output. Each scenario logs the email to sign in to
`epr-frontend` with, alongside the organisation, registration and summary log
ids and the path of the workbook it uploaded (under `data/`). Nothing is torn
down afterwards, and running it again adds five more organisations.

The sign-in email opens with the scenario's prefix - `regOnlyExp`,
`regOnlyRep`, `accExp`, `accRepIn` or `accRepOut` - so the Defra ID stub's
user list says which is which. The rows are drawn from fixed seeds, so each
accredited scenario comes out with the same waste balance on every run (also
logged); only the dates of the loads move, following today's date.

A single scenario has a tag of its own, such as
`@summaryLogScenarioReprocessorInput` - see
`test/localonly/summary-log-scenarios.localonly.api.e2e.js`.

### Simulating a year of operator activity

The two generators above make a handful of records to poke at. For a whole
estate with a year of history behind it, shaped like production, run the
operator activity simulator: it brings the local stack onto a simulated clock
and replays a year of approvals, uploads, reports and PRNs through the
service's own APIs, at whatever fraction of the register you ask for.
[`test/support/simulator/README.md`](test/support/simulator/README.md) walks
from a fresh checkout to a signed-in operator.

### Debugging local tests

```bash
npm run test:local:debug
```

## Production

### Running the tests

Tests are run from the CDP-Portal under the Test Suites section. Before any changes can be run, a new docker image must be built, this will happen automatically when a pull request is merged into the `main` branch.
You can check the progress of the build under the actions section of this repository. Builds typically take around 1-2 minutes.

The results of the test run are made available in the portal.

### Running tests with Profile

By default in the CDP-Portal only tests tagged with @smoketest are run. If you wish to run all the tests, pass in `all` in the profile section of the CDP Portal UI.

`extTestOnly` runs just the `@extTestOnly` subset (currently the operator smoketest that signs in through real GOV.UK One Login) via `npm run test:extTestOnly` - use this profile when running against ext-test specifically, since these specs skip themselves everywhere else.

Two other profiles skip the test run entirely and instead seed data via the
[data generator](#generating-test-organisation-data), exiting immediately
afterwards:

- `generate` - runs `npm run generatedata:allMaterialsMixed:withLinking`
- `generateInd` - runs `npm run generatedata:withLinking`

### Choosing stub or real identity providers

An environment stubs some identity providers and deploys others for real, and the combination differs between environments. `test/config/config.js` holds the default for each environment. Set a provider's mode variable to follow an environment that is wired differently, or that is rewired after the default was written:

| Provider   | Mode variable     | Real by default in | Credentials it then needs                                                                                                                                                       |
| ---------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entra      | `ENTRA_MODE`      | `test`, `ext-test` | `ENTRA_CLIENT_SECRET`, `ENTRA_USERNAME`, `ENTRA_PASSWORD`, `REGULATOR_ENTRA_USERNAME`, `REGULATOR_ENTRA_PASSWORD`, `UNRECOGNISED_ENTRA_USERNAME`, `UNRECOGNISED_ENTRA_PASSWORD` |
| Basic auth | `BASIC_AUTH_MODE` | `test`             | `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`                                                                                                                                    |
| Cognito    | `COGNITO_MODE`    | `test`             | `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`                                                                                                                                    |

Defra ID isn't in the table above - every spec except the ext-test-only operator smoketest signs in through the Defra ID stub regardless of environment (see the note in `test/config/config.js`). That one spec needs `DEFRA_ID_USERNAME`/`DEFRA_ID_PASSWORD` - a GOV.UK One Login account already linked to an organisation in ext-test.

Each variable takes `real` or `stub`, and wins over the default. Any other value stops the run. A local run takes every stub unless a mode variable asks otherwise.

A run that reaches a real provider without its credentials fails naming the missing variable, rather than sending a blank one and reporting whatever the provider says about it.

Defra ID still has no mode variable - every spec but the ext-test-only operator smoketest reaches it through the stub regardless of environment, since the suite otherwise holds no real CPDev sign-in path (see above).

## Requirements of CDP Environment Tests

1. Your service builds as a docker container using the `.github/workflows/publish.yml`
   The workflow tags the docker images allowing the CDP Portal to identify how the container should be run on the platform.
   It also ensures its published to the correct docker repository.

2. The Dockerfile's entrypoint script should return exit code of 0 if the test suite passes or 1/>0 if it fails

3. Test reports should be published to S3 using the script in `./bin/publish-tests.sh`

## Running on GitHub

Alternatively you can run the test suite as a GitHub workflow.
Test runs on GitHub are not able to connect to the CDP Test environments. Instead, they run the tests against the three apps under test (`epr-frontend`, `epr-backend`, `epr-re-ex-admin-frontend`) running in docker, alongside their backing services (mongodb, redis, floci as an AWS emulator, cognito-stub, defra-id-stub, epr-re-ex-entra-stub) and a `selenium-chrome` container for headless runs. `docker/scripts/` pre-populates mongo and creates the floci (S3/SQS/SNS) resources each app needs on startup.

Each app service's `build:` block builds from a sibling checkout (`../epr-backend`, etc.) by default when one exists; override `EPR_BACKEND`/`EPR_FRONTEND`/`EPR_RE_EX_ADMIN_FRONTEND` to pin a specific published image tag instead. `run-journey-tests/action.yml` uses this same mechanism to test a matching in-flight branch from any of the three app repos against this suite - see [Feature flags in journey tests](#feature-flags-in-journey-tests) above for how flag state stays consistent across that boundary.

Steps:

1. Test the setup locally with `docker compose up -d --build` and `npm run test:github`.
2. `.github/workflows/journey-tests.yml` is already wired up to run on manual dispatch or when called from another workflow.

By default, the provided workflow will run when triggered manually from GitHub or when triggered by another workflow.

If you want to use the repository exclusively for running docker composed based test suites consider disabling the publish.yml workflow.

### Running the suite in parts

Each run of `run-journey-tests` brings up its own stack, so a pull request can run the suite as parallel legs. These inputs choose what a leg runs, and combine:

- `test-scope`: `all` (the default), `frontend` (the specs outside `admin/`) or `admin`.
- `test-suite`: `all` (the default) or `e2e`, which both run the browser specs.
- `december-scope`: `all`, `only` (the `@decWaste` specs) or `exclude`.
- `shard`: `current/total`, for example `2/3`. It splits the browser specs in scope by file, dealt out round-robin so that the heavy `summarylogs.*` files land in different shards. Playwright's own `--shard` splits contiguously and puts them together. It needs `test-suite: e2e` and a `december-scope` other than `only`. Files are dealt out before the tags are matched, so a selection only a few files carry, such as `@decWaste`, would leave some shards with no test.

`npm run test:github:browser` runs `bin/run-browser-specs.js`, which turns these into Playwright arguments (`test/support/playwright-args.js`, unit tested) and starts Playwright with them; any extra arguments, such as `--list`, are passed on. The generator smoke steps run on one leg only: the first shard, or the unsharded leg that is not December-only.

This repository's own pull request workflow runs the `baseline` `e2e` specs (`december-scope: exclude`) as three shards and the `december` specs as one leg, and `tests-gate` still reports the single required check.

## BrowserStack

A single Playwright configuration, `playwright.browserstack.config.js`, runs the tests against BrowserStack from both a GitHub workflow and the CDP Portal.
It can be run from npm using `npm run test:browserstack` (for running via portal) and `npm run test:github:browserstack` (from a GitHub runner).
See the CDP Documentation for more details.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government licence v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
