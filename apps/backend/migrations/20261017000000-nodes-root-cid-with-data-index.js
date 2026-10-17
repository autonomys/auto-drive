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

// Partial index supporting nodesRepository.getArchivedRootCidsWithData (the
// reclaim sweep in issue #820). Built CONCURRENTLY outside db-migrate's
// transaction wrapper so it does not take a SHARE lock on public.nodes.
var DROP_INDEX = 'DROP INDEX IF EXISTS public.idx_nodes_root_cid_with_data'

var CREATE_INDEX_CONCURRENTLY =
  'CREATE INDEX CONCURRENTLY idx_nodes_root_cid_with_data ' +
  'ON public.nodes (root_cid) ' +
  'WHERE encoded_node IS NOT NULL'

exports.up = function (db) {
  return db
    .runSql('COMMIT;')
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
    '20261017000000-nodes-root-cid-with-data-index-down.sql',
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
