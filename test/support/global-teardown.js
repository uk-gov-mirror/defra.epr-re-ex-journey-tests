import allure from 'allure-commandline'
import { copyAllureCategories } from './allure-report.js'
import { defraIdStub } from './defra-id-stub.js'
import { collectZapReport } from './zap.js'

const oneMinute = 60 * 1000
const isLocalDev = !process.env.CI && !process.env.ENVIRONMENT

export default async function globalTeardown() {
  // Before the local-only report generation below, so the ZAP result is in
  // allure-results by the time `allure generate` reads them.
  await collectZapReport()

  // wdio.local.conf.js's onComplete hook used to do this after every local
  // run; carry it over so `npm run test:local` still auto-opens the report
  // instead of leaving it for a separate `npm run report` step. CI/CDP
  // Portal runs publish differently (bin/publish-tests.sh), so this stays
  // local-only, matching the original's scoping to wdio.local.conf.js.
  if (!isLocalDev) {
    await defraIdStub.expireAllUsers()
    return
  }

  await copyAllureCategories()

  /** @type {Promise<void>} */
  const reportGenerated = new Promise((resolve, reject) => {
    const reportError = new Error('Could not generate Allure report')
    const generation = allure(['generate', 'allure-results', '--clean'])
    const generationTimeout = setTimeout(() => reject(reportError), oneMinute)

    generation.on('exit', (exitCode) => {
      clearTimeout(generationTimeout)

      if (exitCode !== 0) {
        return reject(reportError)
      }

      allure(['open'])
      resolve()
    })
  })

  await reportGenerated
}
