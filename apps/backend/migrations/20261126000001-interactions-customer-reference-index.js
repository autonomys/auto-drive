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

// A partner end user's upload quota is counted from their interactions, by
// account and customer reference, on every upload they make. Built
// CONCURRENTLY outside db-migrate's transaction wrapper so it does not take a
// SHARE lock on public.interactions.
var DROP_INDEX =
  'DROP INDEX IF EXISTS public.idx_interactions_account_customer_reference'

var CREATE_INDEX_CONCURRENTLY =
  'CREATE INDEX CONCURRENTLY idx_interactions_account_customer_reference ' +
  'ON public.interactions (account_id, customer_reference) ' +
  'WHERE customer_reference IS NOT NULL'

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
    '20261126000001-interactions-customer-reference-index-down.sql',
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
