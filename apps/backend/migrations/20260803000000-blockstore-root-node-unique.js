'use strict'

var dbm
var type
var seed
var fs = require('fs')
var path = require('path')
var Promise

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
  Promise = options.Promise
}

// A plain CREATE UNIQUE INDEX takes a SHARE lock for the whole build, and
// uploads.blockstore holds the node payloads of every in-flight upload — so it
// would block uploads for as long as the build takes, on a table whose size is
// whatever the backlog happens to be. CONCURRENTLY builds it without blocking
// writes, but it cannot run inside a transaction block and db-migrate wraps every
// migration in one (its startMigration issues BEGIN, endMigration COMMIT).
//
// So: run the deduplication inside that transaction, COMMIT it, build the index in
// autocommit, then reopen a transaction so db-migrate's own migration-record
// insert and its closing COMMIT stay balanced. Each statement needs its own
// runSql call for the same reason — a multi-statement simple query is itself an
// implicit transaction block, which CONCURRENTLY would reject.
//
// Failure is safe in both directions. If the build fails, no migration record is
// written, so the migration re-runs; the deduplication it already committed is
// idempotent. A failed CONCURRENTLY build leaves the index INVALID rather than
// absent, which is why the DROP runs first — without it a re-run would find the
// name taken and leave an index that enforces nothing. And an absent index only
// costs the backstop: the ON CONFLICT DO NOTHING on the root-node insert stops
// firing, which is exactly the behaviour that shipped before this branch, with the
// app-level completion claim still in place.
//
// The one race left is a duplicate root row inserted between the COMMIT and the
// build, which fails the build; re-running the migration deduplicates again and
// rebuilds.
var DROP_INDEX = 'DROP INDEX IF EXISTS uploads.blockstore_root_node_unique_idx'

var CREATE_INDEX_CONCURRENTLY =
  'CREATE UNIQUE INDEX CONCURRENTLY blockstore_root_node_unique_idx ' +
  'ON uploads.blockstore (upload_id, cid) ' +
  "WHERE node_type IN ('File', 'Folder')"

exports.up = function (db) {
  var filePath = path.join(
    __dirname,
    'sqls',
    '20260803000000-blockstore-root-node-unique-up.sql',
  )
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, { encoding: 'utf-8' }, function (err, data) {
      if (err) return reject(err)
      resolve(data)
    })
  })
    .then(function (data) {
      return db.runSql(data)
    })
    .then(function () {
      return db.runSql('COMMIT;')
    })
    .then(function () {
      return db.runSql(DROP_INDEX)
    })
    .then(function () {
      return db.runSql(CREATE_INDEX_CONCURRENTLY)
    })
    .then(function () {
      return db.runSql('BEGIN;')
    })
}

exports.down = function (db) {
  var filePath = path.join(
    __dirname,
    'sqls',
    '20260803000000-blockstore-root-node-unique-down.sql',
  )
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, { encoding: 'utf-8' }, function (err, data) {
      if (err) return reject(err)
      resolve(data)
    })
  }).then(function (data) {
    return db.runSql(data)
  })
}

exports._meta = {
  version: 1,
}
