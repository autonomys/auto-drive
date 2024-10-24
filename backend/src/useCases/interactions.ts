import { v4 } from "uuid";
import { InteractionType } from "../models/interactions.js";
import { interactionsRepository } from "../repositories/interactions.js";

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
