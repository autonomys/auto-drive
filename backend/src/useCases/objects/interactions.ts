import { v4 } from "uuid";
import { InteractionType } from "../../models/objects/interactions.js";
import { interactionsRepository } from "../../repositories/objects/interactions.js";

const createInteraction = async (
  subscriptionId: string,
  type: InteractionType,
  size: number
): Promise<void> => {
  await interactionsRepository.createInteraction(
    v4(),
    subscriptionId,
    type,
    size
  );
};

export const InteractionsUseCases = {
  createInteraction,
};
