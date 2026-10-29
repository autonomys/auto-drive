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

// CONCURRENTLY cannot run inside a transaction block and db-migrate wraps every
// migration in one, so the index statements run between a COMMIT and a BEGIN,
// each in its own runSql call. 20260803000000-blockstore-root-node-unique.js
// explains this in full.
//
// A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would
// keep, so only an invalid index is dropped before the build. A valid one, for
// example built by hand ahead of the migration, is kept.
//
// The SQL files use SET LOCAL lock_timeout so the timeout ends at the COMMIT:
// CONCURRENTLY waits for older transactions, and timing out there would leave
// the index INVALID.
//
// The index is ascending only. The file tables send plain asc and desc, and a
// backward scan serves desc.
var INVALID_INDEX =
  'SELECT 1 FROM pg_index ' +
  "WHERE indexrelid = to_regclass('public.idx_root_metadata_name') " +
  'AND NOT indisvalid'

var DROP_INDEX_CONCURRENTLY =
  'DROP INDEX CONCURRENTLY IF EXISTS public.idx_root_metadata_name'

var CREATE_INDEX_CONCURRENTLY =
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_root_metadata_name ' +
  'ON public.metadata USING btree (name) ' +
  'WHERE (root_cid = head_cid)'

exports.up = function (db) {
  var filePath = path.join(
    __dirname,
    'sqls',
    '20261029000000-metadata-root-name-index-up.sql',
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
      return db.all(INVALID_INDEX)
    })
    .then(function (rows) {
      if (rows.length > 0) return db.runSql(DROP_INDEX_CONCURRENTLY)
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
    '20261029000000-metadata-root-name-index-down.sql',
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
      return db.runSql(DROP_INDEX_CONCURRENTLY)
    })
    .then(function () {
      return db.runSql('BEGIN;')
    })
}

exports._meta = {
  version: 1,
}
