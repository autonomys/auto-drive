import { InteractionsUseCases } from '../../../src/useCases/objects/interactions.js'
import { InteractionType } from '../../../src/models/objects/interactions.js'

describe('InteractionsUseCases', () => {
  beforeEach(async () => {})

  describe('createInteraction', () => {
    it('should create an interaction successfully', async () => {
      const subscriptionId = 'test-subscription-id'
      const type = InteractionType.Download
      const size = BigInt(1024)

      await expect(
        InteractionsUseCases.createInteraction(subscriptionId, type, size),
      ).resolves.not.toThrow()
    })

    it('should throw an error if subscriptionId is invalid', async () => {
      const invalidSubscriptionId = ''
      const type = InteractionType.Upload
      const size = BigInt(2048)

      await expect(
        InteractionsUseCases.createInteraction(
          invalidSubscriptionId,
          type,
          size,
        ),
      ).rejects.toThrow()
    })

    it('should throw an error if size is negative', async () => {
      const subscriptionId = 'test-subscription-id'
      const type = InteractionType.Download
      const size = BigInt(-1024)

      await expect(
        InteractionsUseCases.createInteraction(subscriptionId, type, size),
      ).rejects.toThrow()
    })
  })
})
