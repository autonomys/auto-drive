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

// metadata is written by every upload, so the index is built CONCURRENTLY to
// avoid blocking writes for the length of the build. As in
// 20260803000000-blockstore-root-node-unique.js, that means leaving
// db-migrate's transaction (CONCURRENTLY cannot run inside one) and reopening
// it afterwards so its migration-record insert and closing COMMIT stay
// balanced. The DROP clears an INVALID index left by a failed build, which
// would otherwise make a re-run fail on the taken name.
var DROP_INDEX =
  'DROP INDEX IF EXISTS public.idx_root_metadata_created_at_desc_nulls_last'

exports.up = function (db) {
  var filePath = path.join(
    __dirname,
    'sqls',
    '20261027000000-root-metadata-created-at-desc-index-up.sql',
  )
  return new Promise(function (resolve, reject) {
    fs.readFile(filePath, { encoding: 'utf-8' }, function (err, data) {
      if (err) return reject(err)
      resolve(data)
    })
  }).then(function (data) {
    return db
      .runSql('COMMIT;')
      .then(function () {
        return db.runSql(DROP_INDEX)
      })
      .then(function () {
        return db.runSql(data)
      })
      .then(function () {
        return db.runSql('BEGIN;')
      })
  })
}

exports.down = function (db) {
  var filePath = path.join(
    __dirname,
    'sqls',
    '20261027000000-root-metadata-created-at-desc-index-down.sql',
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
