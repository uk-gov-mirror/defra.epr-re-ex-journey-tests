import { BaseAPI } from '../apis/base-api.js'
import { AuthClient } from './auth.js'
import { assertSuccessResponse } from './response-assertions.js'

/**
 * The years the backend serves waste records for, as it orders them.
 *
 * @returns {Promise<string[]>}
 */
export async function availableWasteRecordYears() {
  const authClient = new AuthClient()
  await authClient.authenticate()

  const response = await new BaseAPI().get(
    '/waste-records/years',
    authClient.authHeader()
  )
  const { years } = await assertSuccessResponse(
    response,
    'GET /waste-records/years'
  )

  return years.map(({ year }) => String(year))
}
