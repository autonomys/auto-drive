const state = {
  executing: false,
  time: 10_000,
}

export const nodeMigrator = {
  start: (time: number = 10_000) => {
    state.time = time
  },
}
