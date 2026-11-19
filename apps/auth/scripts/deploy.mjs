import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const authRoot = fileURLToPath(new URL('../', import.meta.url))

export function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: options.env ?? process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${binary} ${args[0]} failed (exit ${result.status})`)
  }
  return options.capture ? JSON.parse(result.stdout) : undefined
}

export async function waitForBackup(
  aws,
  jobId,
  { sleep = setTimeout, now = Date.now, timeout = 60 * 60 * 1000 } = {},
) {
  const deadline = now() + timeout
  while (now() < deadline) {
    const job = aws(['backup', 'describe-backup-job', '--backup-job-id', jobId])
    if (job.State === 'COMPLETED') {
      if (!job.RecoveryPointArn) throw new Error('Backup has no recovery point')
      return job.RecoveryPointArn
    }
    if (!['CREATED', 'PENDING', 'RUNNING'].includes(job.State)) {
      throw new Error(`Backup ${jobId} ended in ${job.State}`)
    }
    await sleep(15_000)
  }
  throw new Error(
    `Timed out waiting for backup ${jobId}; migration was not run`,
  )
}

export function validateTarget(env, identity, lambda) {
  const region = env.AWS_REGION
  const endpoint = env.DSQL_CLUSTER_ENDPOINT
  const arn = env.AUTH_DSQL_CLUSTER_ARN
  if (!region || !endpoint || !arn || !env.AUTH_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      'AWS_REGION, DSQL_CLUSTER_ENDPOINT, AUTH_DSQL_CLUSTER_ARN and AUTH_LAMBDA_FUNCTION_NAME are required',
    )
  }
  const match =
    /^arn:aws:dsql:([a-z0-9-]+):(\d{12}):cluster\/([a-z0-9]+)$/.exec(arn)
  if (
    !match ||
    match[1] !== region ||
    match[2] !== identity.Account ||
    endpoint !== `${match[3]}.dsql.${region}.on.aws`
  ) {
    throw new Error(
      'DSQL endpoint, cluster ARN, region and AWS account must match',
    )
  }
  if (lambda.endpoint !== endpoint) {
    throw new Error('Selected Lambda uses a different DSQL endpoint')
  }
}

export async function deploy(
  mode,
  {
    env = process.env,
    execute = run,
    wait = waitForBackup,
    readPlan = (path) => JSON.parse(readFileSync(path, 'utf8')),
    summary = (text) => {
      console.log(text)
      if (env.GITHUB_STEP_SUMMARY)
        appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)
    },
  } = {},
) {
  if (!['plan', 'adopt', 'deploy'].includes(mode)) {
    throw new Error('Usage: node scripts/deploy.mjs plan|adopt|deploy')
  }
  for (const key of [
    'AWS_REGION',
    'DSQL_CLUSTER_ENDPOINT',
    'AUTH_DSQL_CLUSTER_ARN',
    'AUTH_LAMBDA_FUNCTION_NAME',
  ]) {
    if (!env[key]) throw new Error(`${key} is required`)
  }
  const aws = (args) =>
    execute(
      'aws',
      [
        ...args,
        '--region',
        env.AWS_REGION,
        '--output',
        'json',
        '--no-cli-pager',
      ],
      { capture: true, env },
    )
  const identity = aws(['sts', 'get-caller-identity'])
  // Restrict output to the target endpoint, never print Lambda secrets.
  const lambda = aws([
    'lambda',
    'get-function-configuration',
    '--function-name',
    env.AUTH_LAMBDA_FUNCTION_NAME,
    '--query',
    '{endpoint:Environment.Variables.DSQL_CLUSTER_ENDPOINT}',
  ])
  validateTarget(env, identity, lambda)

  const directory = mkdtempSync(join(tmpdir(), 'auth-migrations-'))
  const planPath = join(directory, 'plan.json')
  const migrate = (command) =>
    execute(
      'java',
      ['-jar', join(authRoot, 'flyway/target/auth-migrations.jar'), command],
      {
        env: { ...env, AUTH_MIGRATION_PLAN: planPath },
      },
    )
  try {
    migrate('plan')
    const plan = readPlan(planPath)
    if (
      !Number.isInteger(plan.pending) ||
      plan.pending < 0 ||
      typeof plan.adoptionRequired !== 'boolean'
    ) {
      throw new Error('Invalid migration plan')
    }
    summary(
      `Auth ${mode}: ${plan.pending} pending; adoption required: ${plan.adoptionRequired}.`,
    )
    if (mode === 'plan') return
    if (mode === 'deploy' && plan.adoptionRequired) {
      throw new Error(
        'Run the explicit adopt operation before deploying this legacy database',
      )
    }
    if (mode === 'adopt' && !plan.adoptionRequired) {
      throw new Error('This database does not need adoption')
    }
    if (plan.pending > 0 || mode === 'adopt') {
      if (!env.AUTH_BACKUP_VAULT || !env.AUTH_BACKUP_ROLE_ARN) {
        throw new Error(
          'AUTH_BACKUP_VAULT and AUTH_BACKUP_ROLE_ARN are required',
        )
      }
      const retention = Number(env.AUTH_BACKUP_RETENTION_DAYS || '7')
      if (!Number.isInteger(retention) || retention < 1) {
        throw new Error('AUTH_BACKUP_RETENTION_DAYS must be a positive integer')
      }
      const backup = aws([
        'backup',
        'start-backup-job',
        '--resource-arn',
        env.AUTH_DSQL_CLUSTER_ARN,
        '--backup-vault-name',
        env.AUTH_BACKUP_VAULT,
        '--iam-role-arn',
        env.AUTH_BACKUP_ROLE_ARN,
        '--lifecycle',
        JSON.stringify({ DeleteAfterDays: retention }),
      ])
      if (!backup.BackupJobId)
        throw new Error('AWS Backup did not return a job ID')
      summary(`Backup job: ${backup.BackupJobId}`)
      const recoveryPoint = await wait(aws, backup.BackupJobId)
      summary(`Pre-migration recovery point: ${recoveryPoint}`)
    }
    migrate(mode === 'adopt' ? 'adopt' : 'migrate')
    if (mode === 'adopt') return
    migrate('verify')
    aws([
      'lambda',
      'update-function-code',
      '--function-name',
      env.AUTH_LAMBDA_FUNCTION_NAME,
      '--zip-file',
      `fileb://${join(authRoot, 'build/index.zip')}`,
    ])
    // Waiters have no JSON body.
    execute(
      'aws',
      [
        'lambda',
        'wait',
        'function-updated-v2',
        '--function-name',
        env.AUTH_LAMBDA_FUNCTION_NAME,
        '--region',
        env.AWS_REGION,
      ],
      { env },
    )
    summary(
      `Deployed ${env.GITHUB_SHA || 'local artifact'} to ${env.AUTH_LAMBDA_FUNCTION_NAME}.`,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  deploy(process.argv[2]).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
