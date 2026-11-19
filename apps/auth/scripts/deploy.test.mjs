import assert from 'node:assert/strict'
import test from 'node:test'
import { deploy, validateTarget, waitForBackup } from './deploy.mjs'

const env = {
  AWS_REGION: 'us-east-2',
  DSQL_CLUSTER_ENDPOINT: 'example.dsql.us-east-2.on.aws',
  AUTH_DSQL_CLUSTER_ARN: 'arn:aws:dsql:us-east-2:123456789012:cluster/example',
  AUTH_LAMBDA_FUNCTION_NAME: 'auth-test',
  AUTH_BACKUP_VAULT: 'test-vault',
  AUTH_BACKUP_ROLE_ARN: 'arn:aws:iam::123456789012:role/backup',
}

function harness({
  pending = 1,
  adoptionRequired = false,
  failMigration = false,
} = {}) {
  const calls = []
  return {
    calls,
    options: {
      env,
      execute(binary, args) {
        calls.push([binary, ...args])
        if (binary === 'java') {
          if (failMigration && args.at(-1) === 'migrate')
            throw new Error('DDL failed')
          return
        }
        if (args[0] === 'sts') return { Account: '123456789012' }
        if (args[1] === 'get-function-configuration')
          return { endpoint: env.DSQL_CLUSTER_ENDPOINT }
        if (args[1] === 'start-backup-job') return { BackupJobId: 'backup-1' }
        return {}
      },
      readPlan: () => ({ pending, adoptionRequired }),
      wait: async () => {
        calls.push(['backup-completed'])
        return 'recovery-1'
      },
      summary() {},
    },
  }
}

test('backup completion and migration verification precede code deployment', async () => {
  const { calls, options } = harness()
  await deploy('deploy', options)
  const index = (predicate) => calls.findIndex(predicate)
  assert.ok(
    index((c) => c[0] === 'backup-completed') <
      index((c) => c.at(-1) === 'migrate'),
  )
  assert.ok(
    index((c) => c.at(-1) === 'verify') <
      index((c) => c[2] === 'update-function-code'),
  )
  assert.ok(calls.some((c) => c[2] === 'wait'))
})

test('planning never backs up, migrates, or updates Lambda', async () => {
  const { calls, options } = harness({ adoptionRequired: true })
  await deploy('plan', options)
  assert.equal(calls.filter((c) => c[0] === 'java').length, 1)
  assert.ok(
    !calls.some((c) => c[1] === 'backup' || c[2] === 'update-function-code'),
  )
})

test('migration failure prevents Lambda update', async () => {
  const { calls, options } = harness({ failMigration: true })
  await assert.rejects(deploy('deploy', options), /DDL failed/)
  assert.ok(!calls.some((c) => c[2] === 'update-function-code'))
})

test('backup failure prevents migration and deployment', async () => {
  const { calls, options } = harness()
  options.wait = async () => {
    throw new Error('Backup failed')
  }
  await assert.rejects(deploy('deploy', options), /Backup failed/)
  assert.ok(
    !calls.some(
      (c) => c.at(-1) === 'migrate' || c[2] === 'update-function-code',
    ),
  )
})

test('existing schema requires explicit adoption; adopt never deploys', async () => {
  const { calls, options } = harness({ adoptionRequired: true })
  await assert.rejects(deploy('deploy', options), /explicit adopt/)
  assert.ok(!calls.some((c) => c[1] === 'backup'))
  await deploy('adopt', options)
  assert.ok(calls.some((c) => c.at(-1) === 'adopt'))
  assert.ok(!calls.some((c) => c[2] === 'update-function-code'))
})

test('no pending migrations skips backup but still verifies before deployment', async () => {
  const { calls, options } = harness({ pending: 0 })
  await deploy('deploy', options)
  assert.ok(!calls.some((c) => c[1] === 'backup'))
  assert.ok(calls.some((c) => c.at(-1) === 'verify'))
  assert.ok(calls.some((c) => c[2] === 'update-function-code'))
})

test('wrong account, region, cluster or Lambda target is rejected', () => {
  const identity = { Account: '123456789012' }
  const lambda = { endpoint: env.DSQL_CLUSTER_ENDPOINT }
  for (const bad of [
    { ...env, AWS_REGION: 'us-east-1' },
    { ...env, DSQL_CLUSTER_ENDPOINT: 'backend.example.com' },
    {
      ...env,
      AUTH_DSQL_CLUSTER_ARN: env.AUTH_DSQL_CLUSTER_ARN.replace(
        'example',
        'other',
      ),
    },
  ])
    assert.throws(() => validateTarget(bad, identity, lambda), /must match/)
  assert.throws(
    () => validateTarget(env, { Account: '000000000000' }, lambda),
    /must match/,
  )
  assert.throws(
    () => validateTarget(env, identity, { endpoint: 'other' }),
    /different DSQL/,
  )
})

test('backup polling accepts only completed jobs with recovery points', async () => {
  const jobs = [
    { State: 'RUNNING' },
    { State: 'COMPLETED', RecoveryPointArn: 'recovery-1' },
  ]
  assert.equal(
    await waitForBackup(() => jobs.shift(), 'id', { sleep: async () => {} }),
    'recovery-1',
  )
  for (const State of [
    'FAILED',
    'ABORTED',
    'EXPIRED',
    'PARTIAL',
    'COMPLETED',
  ]) {
    await assert.rejects(waitForBackup(() => ({ State }), 'id'))
  }
  let time = 0
  await assert.rejects(
    waitForBackup(() => ({ State: 'RUNNING' }), 'id', {
      now: () => time,
      sleep: async () => {
        time += 20
      },
      timeout: 10,
    }),
    /Timed out/,
  )
})
