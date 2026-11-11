'use strict'

var dbm
var type
var seed
var Promise

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
  Promise = options.Promise
}

// Indexes for the usage reports (#893). The only index on interactions that
// covers an account, (type, account_id, created_at), can't return an
// account's rows in (created_at, id) order, so each page of the interactions
// export sorted every remaining row in the range. And nothing narrowed the
// admin list's scan of all accounts to the range.
//
// Every upload and download writes to interactions, and a plain CREATE INDEX
// would block those writes for the whole build. CONCURRENTLY doesn't, but it
// can't run in a transaction, and db-migrate wraps every migration in one. So,
// as in 20260803000000-blockstore-root-node-unique: COMMIT, build each index in
// autocommit with a runSql call of its own, then reopen a transaction for
// db-migrate's record and COMMIT. A failed build leaves its index INVALID and
// writes no record, so each DROP lets a re-run start clean.
var UP = [
  'COMMIT',
  'DROP INDEX IF EXISTS idx_interactions_account_created_at_id',
  'CREATE INDEX CONCURRENTLY idx_interactions_account_created_at_id ' +
    'ON public.interactions (account_id, created_at, id)',
  'DROP INDEX IF EXISTS idx_interactions_created_at',
  'CREATE INDEX CONCURRENTLY idx_interactions_created_at ' +
    'ON public.interactions (created_at)',
  'BEGIN',
]

exports.up = function (db) {
  return UP.reduce(function (run, sql) {
    return run.then(function () {
      return db.runSql(sql)
    })
  }, Promise.resolve())
}

exports.down = function (db) {
  return db.runSql(
    'DROP INDEX IF EXISTS idx_interactions_account_created_at_id;' +
      'DROP INDEX IF EXISTS idx_interactions_created_at;',
  )
}

exports._meta = {
  version: 1,
}
