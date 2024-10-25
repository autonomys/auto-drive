import { nodesRepository } from "../../repositories/index.js";
import { NodesUseCases } from "../../useCases/index.js";
import { BlockstoreUseCases } from "../../useCases/uploads/blockstore.js";
import { UploadsUseCases } from "../../useCases/uploads/uploads.js";
import { safeCallback } from "../../utils/safe.js";

let state = {
  executing: false,
  time: 10_000,
};

const processPendingMigrations = safeCallback(async () => {
  if (state.executing) {
    return;
  }

  state.executing = true;

  try {
    const pendingMigrations = await UploadsUseCases.getPendingMigrations(1);
    console.log(`Found ${pendingMigrations.length} pending migrations`);
    if (pendingMigrations.length === 0) {
      return;
    }

    for (const upload of pendingMigrations) {
      console.log(`Processing migration for upload ${upload.id}`);
      await UploadsUseCases.processMigration(upload.id);
    }
  } finally {
    state.executing = false;
  }
});

export const nodeMigrator = {
  start: (time: number = 10_000) => {
    state.time = time;
    setInterval(processPendingMigrations, state.time);
  },
};
