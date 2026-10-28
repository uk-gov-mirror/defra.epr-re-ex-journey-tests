import { resetTracker } from './cleanup-tracker.js'
import { resetZapSession } from './zap.js'

export default async function globalSetup() {
  resetTracker()
  await resetZapSession()
}
