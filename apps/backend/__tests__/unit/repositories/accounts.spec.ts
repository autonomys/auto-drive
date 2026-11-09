import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { accountsRepository } from '../../../src/infrastructure/repositories/users/accounts.js'
import { dbMigration } from '../../utils/dbMigrate.js'

// Runs against the migrated TestContainers Postgres (requires Docker).
describe('Accounts Repository — createAccount', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  it('gives concurrent creates for one organization the same account', async () => {
    const [first, second] = await Promise.all([
      accountsRepository.createAccount(
        'acc-race-1',
        'org-race',
        'monthly',
        1,
        1,
      ),
      accountsRepository.createAccount(
        'acc-race-2',
        'org-race',
        'monthly',
        2,
        2,
      ),
    ])

    expect(second.id).toBe(first.id)
    expect(await accountsRepository.getByOrganizationId('org-race')).toEqual(
      first,
    )
  })
})
