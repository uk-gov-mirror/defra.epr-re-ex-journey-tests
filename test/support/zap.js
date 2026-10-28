import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import config from '../config/config.js'
import logger from './logger.js'

// ZAP serves its API on the same port it proxies on, so ZAP_API_URL is the
// same address the browser is pointed at via HTTP_PROXY (see `npm run
// test:zap`). Unset means no ZAP run - every helper here is then a no-op.
const zapApiUrl = process.env.ZAP_API_URL

// Only report on the apps under test. The journeys also drive the browser
// through the defra-id/entra stubs and wire-mock, but alerts on those are
// noise - they never ship.
const scannedOrigins = [
  `http://localhost:${process.env.FRONTEND_PORT || 3000}`,
  new URL(config.adminUri).origin
]

const riskOrder = ['High', 'Medium', 'Low', 'Informational']
const passiveScanTimeout = 5 * 60 * 1000
const pollInterval = 2000

export const isZapRun = !!zapApiUrl

async function zapApi(apiPath, params = {}) {
  const url = new URL(apiPath, zapApiUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`ZAP API ${apiPath} returned ${response.status}`)
  }
  return apiPath.startsWith('/JSON/') ? response.json() : response.text()
}

/**
 * Starts a fresh ZAP session so alerts from an earlier run against the same
 * long-lived ZAP container don't bleed into this one.
 */
export async function resetZapSession() {
  if (!isZapRun) {
    return
  }
  await zapApi('/JSON/core/action/newSession/', { overwrite: 'true' })
}

async function waitForPassiveScan() {
  const deadline = Date.now() + passiveScanTimeout
  while (Date.now() < deadline) {
    const { recordsToScan } = await zapApi('/JSON/pscan/view/recordsToScan/')
    if (Number(recordsToScan) === 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }
  throw new Error('Timed out waiting for the ZAP passive scan to finish')
}

async function fetchAlerts() {
  const alerts = []
  for (const baseurl of scannedOrigins) {
    const { alerts: found } = await zapApi('/JSON/core/view/alerts/', {
      baseurl
    })
    alerts.push(...found)
  }
  return alerts
}

function summarise(alerts) {
  const byRisk = Object.fromEntries(riskOrder.map((risk) => [risk, 0]))
  const distinct = new Map()
  for (const alert of alerts) {
    const key = `${alert.pluginId}:${alert.risk}`
    if (!distinct.has(key)) {
      distinct.set(key, { ...alert, urls: new Set() })
      byRisk[alert.risk] = (byRisk[alert.risk] ?? 0) + 1
    }
    distinct.get(key).urls.add(alert.url)
  }
  return { byRisk, distinct: [...distinct.values()] }
}

function describe({ byRisk, distinct }) {
  const counts = riskOrder.map((risk) => `${risk}: ${byRisk[risk]}`).join(', ')
  const lines = distinct
    .sort((a, b) => riskOrder.indexOf(a.risk) - riskOrder.indexOf(b.risk))
    .map(
      (alert) =>
        `[${alert.risk}] ${alert.alert} (${alert.urls.size} URL${alert.urls.size === 1 ? '' : 's'})`
    )
  return [`Distinct alerts - ${counts}`, '', ...lines].join('\n')
}

/**
 * Waits for ZAP to finish passively scanning everything the journeys sent
 * through it, then writes its reports into `zap-report/` and adds a
 * synthetic "ZAP passive scan" result to allure-results with the reports
 * attached. The result is marked failed when any High-risk alert was
 * raised against an app under test, but never fails the Playwright run
 * itself - it's a report, not a gate.
 * @param {string} resultsDir
 */
export async function collectZapReport(resultsDir = 'allure-results') {
  if (!isZapRun) {
    return
  }

  const start = Date.now()
  await waitForPassiveScan()

  const [alerts, htmlReport] = await Promise.all([
    fetchAlerts(),
    zapApi('/OTHER/core/other/htmlreport/')
  ])
  const summary = summarise(alerts)
  const message = describe(summary)

  await mkdir('zap-report', { recursive: true })
  await writeFile(path.join('zap-report', 'zap-report.html'), htmlReport)
  await writeFile(
    path.join('zap-report', 'zap-alerts.json'),
    JSON.stringify(alerts, null, 2)
  )

  await mkdir(resultsDir, { recursive: true })
  const htmlSource = `${randomUUID()}-attachment.html`
  const jsonSource = `${randomUUID()}-attachment.json`
  await writeFile(path.join(resultsDir, htmlSource), htmlReport)
  await writeFile(
    path.join(resultsDir, jsonSource),
    JSON.stringify(alerts, null, 2)
  )

  const uuid = randomUUID()
  await writeFile(
    path.join(resultsDir, `${uuid}-result.json`),
    JSON.stringify({
      uuid,
      historyId: 'zap-passive-scan',
      testCaseId: 'zap-passive-scan',
      name: 'ZAP passive scan',
      fullName: 'security: ZAP passive scan',
      status: summary.byRisk.High > 0 ? 'failed' : 'passed',
      statusDetails: { message },
      stage: 'finished',
      start,
      stop: Date.now(),
      labels: [
        { name: 'parentSuite', value: 'Security' },
        { name: 'suite', value: 'ZAP' },
        { name: 'tag', value: 'zap' }
      ],
      attachments: [
        { name: 'ZAP report', source: htmlSource, type: 'text/html' },
        { name: 'ZAP alerts', source: jsonSource, type: 'application/json' }
      ]
    })
  )

  logger.info(`ZAP passive scan of ${scannedOrigins.join(', ')}\n${message}`)
}
