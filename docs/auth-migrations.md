# Auth DSQL migrations

The auth Lambda deploys through
[`auto-drive-auth-deploy.yml`](../.github/workflows/auto-drive-auth-deploy.yml).
Flyway executes SQL using AWS's DSQL adapter and JDBC IAM connector. The JVM is
used only by deployment tooling; it is not added to the Lambda bundle.

The published dependency combination is Flyway **11.9.0**,
`software.amazon.dsql:aurora-dsql-flyway-support:3.0.0`, and
`software.amazon.dsql:aurora-dsql-jdbc-connector:1.5.1`. These are pinned in
[`pom.xml`](../apps/auth/flyway/pom.xml). Do not install the official Flyway DSQL
artifact alongside the AWS artifact: they contain the same plugin classes.
When upgrading, check the published POM, since upstream development can target
a different Flyway version from the released adapter.

## AWS and GitHub setup

Infrastructure belongs in `autonomys/infra`, under
`resources/terraform/auto-drive-production/auth.tf`. This repository does not
provision AWS resources or change the existing Lambda runtime IAM role.

1. Create GitHub environments `auth-staging` and `auth-production`, each pointing
   at a distinct auth Lambda and DSQL cluster. Restrict deployment branches to
   `main`. The workflow also checks the ref before accessing these environments.
2. Configure a deployment IAM role trusted by GitHub OIDC, with audience
   `sts.amazonaws.com` and a subject restricted to this repository and the
   corresponding environment. For the standard subject format, production is
   `repo:autonomys/auto-drive:environment:auth-production`. Match the actual
   subject format used by the repository. Set maximum session duration to at
   least **10,800 seconds** to cover backup and index-building waits.
3. Give this role `dsql:DbConnectAdmin` on that environment's cluster,
   `lambda:GetFunctionConfiguration` and `lambda:UpdateFunctionCode` on its auth
   function, `backup:StartBackupJob` for its backup resources,
   `backup:DescribeBackupJob`, and `iam:PassRole` on the dedicated AWS Backup
   execution role (restricted to `backup.amazonaws.com`). Scope resources where
   each AWS action supports it. Provision the backup service role's DSQL/KMS
   permissions separately; the deployment role is not the backup service role.
4. Opt the **DSQL** resource type into AWS Backup in the target account/Region.
   Create the vault and backup execution role, configure retention/encryption,
   and verify an on-demand backup and restore in staging. The script waits up
   to one hour for a backup; failure, partial completion, or timeout prevents
   migration. Vault retention constraints must accept the selected retention.
5. Configure the following GitHub **environment variables** (not database
   passwords). The target endpoint is compared with the selected Lambda's
   `DSQL_CLUSTER_ENDPOINT`, cluster ARN, caller account, and Region before work.

| Variable                     | Value                                       |
| ---------------------------- | ------------------------------------------- |
| `AUTH_DEPLOY_ROLE_ARN`       | GitHub OIDC deployment role                 |
| `AWS_REGION`                 | DSQL and Lambda Region, e.g. `us-east-2`    |
| `DSQL_CLUSTER_ENDPOINT`      | Bare cluster hostname, without a URL scheme |
| `AUTH_DSQL_CLUSTER_ARN`      | ARN of that same DSQL cluster               |
| `AUTH_LAMBDA_FUNCTION_NAME`  | Auth function, e.g. `auto-drive-auth-v2`    |
| `AUTH_BACKUP_VAULT`          | AWS Backup vault name                       |
| `AUTH_BACKUP_ROLE_ARN`       | Backup service execution role               |
| `AUTH_BACKUP_RETENTION_DAYS` | Optional; defaults to 7 days                |

The runner needs network access to the DSQL endpoint on port 5432. If the cluster
uses a resource policy that restricts access to a VPC endpoint, use a runner with
that connectivity. The connector verifies the TLS certificate and generates
tokens from the job's temporary AWS credentials. It never reads `DATABASE_URL`.

Keep migration permissions out of the runtime Lambda role when implementing
[#699](https://github.com/autonomys/auto-drive/issues/699): provision the non-admin
database role and grants, update runtime authentication, then remove runtime
`dsql:DbConnectAdmin`. This deployment change alone does not complete #699.

## First rollout and baseline adoption

Leave the repository variable `AUTH_DEPLOY_ENABLED` unset until staging succeeds.
Manual workflow runs are available from `main`; the default operation is `plan`.

The six historical `db-migrate` migrations are represented as **18 individual
Flyway migrations**, one DDL statement each, ending at version
`20261027120000.2`. They can initialize an empty DSQL database. Existing
production must be adopted so that Flyway does not replay those statements.

The baseline intentionally describes the production adaptations reported in
[#672](https://github.com/autonomys/auto-drive/issues/672#issuecomment-6508110108):

- `users.deletion_requests` has no foreign key to `users.users`.
- `idx_deletion_requests_scheduled` is a full index.
- Explicit indexes use `CREATE INDEX ASYNC` on DSQL.

Other definitions follow the committed migrations, including the partial
`idx_api_keys_owner` index. These are expectations to verify, not a claim that
production has been inspected. AWS now documents foreign-key and partial-index
support, but adding constraints or changing existing indexes is a separate
schema change, not an implicit part of adoption.

1. Run **plan** for staging, then production. This reads schema/history and
   reports pending versions. It does not create Flyway history, start backups,
   or deploy code. A legacy database is checked against
   [`baseline-schema.txt`](../apps/auth/flyway/src/main/resources/baseline-schema.txt).
   Columns, types, nullability, defaults, constraints, index definitions, and
   index validity must match. Legacy migration names must also match exactly.
2. If verification fails, inspect the reported definitions with
   [`schema-inventory.sql`](../apps/auth/flyway/src/main/resources/schema-inventory.sql).
   Resolve differences explicitly. Catalog rendering may differ between
   PostgreSQL and DSQL; verify any purely textual difference on live DSQL before
   adjusting the fixture. Do not mark missing DDL as applied or weaken checks
   to get a deployment through. Freeze the baseline once adopted; reconcile
   later semantic changes with new migrations.
3. Run **adopt**. It waits for a successful backup, verifies again, then uses
   `baselineOnMigrate` with a fixed baseline and target. It records only that
   baseline and does not deploy Lambda or execute later migrations. Standalone
   `flyway baseline` is not used because of the adapter's documented limitation.
4. Run **deploy**. It plans on every deployment, backs up if migrations are
   pending, migrates, validates history/checksums and schema definitions, then uploads
   the already-tested Lambda ZIP and waits for AWS's update status. With no
   pending migrations, it verifies and deploys without another backup.
5. After the staging checks below and successful production adoption, set the
   **repository** variable `AUTH_DEPLOY_ENABLED=true`. Pushes to `main` affecting
   auth, shared models, the lockfile, or this workflow then deploy automatically.

`auth_migrations` remains untouched, including its microsecond timestamps and
any custom identity/default columns. New history is stored separately in
`public.auth_flyway_schema_history`. Automatic baseline adoption, cleaning,
out-of-order migrations, and deployment from a checkout older than applied
migration history are disabled.

GitHub serializes deployments per environment with `cancel-in-progress: false`.
Use one environment per cluster and route all writers through this workflow;
local runners, other repositories, and differently named environments are not
covered by its concurrency group. GitHub may replace an older pending run with
a newer pending run; each deployment applies all migrations in its checkout.

## Writing new migrations

Keep existing `apps/auth/migrations` files for PostgreSQL development and Jest.
For each new auth schema change, add both the PostgreSQL migration and reviewed
DSQL SQL under `apps/auth/flyway/src/main/resources/db/migration/`. Future changes
must maintain these two paths together.

Update `apps/auth/flyway/src/main/resources/expected-schema.txt` with each schema
change. It is the expected **current** schema, checked after migration and before
Lambda deployment; `baseline-schema.txt` remains the frozen adoption snapshot.
Generate the current snapshot from a staging database after applying the reviewed
migrations, using `schema-inventory.sql` with `psql -XAt -v ON_ERROR_STOP=1`, and
review the definition diff. This catches missing DDL even when history claims it
was applied. Never capture application data in this fixture.

Use `V<UTC timestamp>_<step>__<description>.sql`, for example
`V20261103120000_1__add_optional_profile_field.sql`. Each file must contain exactly
one DDL statement, without `BEGIN`/`COMMIT`; separate DML/backfills from DDL.
Keep backfills within DSQL transaction limits and test them on representative
data. Never edit an applied migration; Flyway validates its checksum.

Use `CREATE INDEX ASYNC` in DSQL SQL. The configured adapter waits for index jobs
before advancing and retries transactional OCC conflicts up to three times.
Do not wrap an entire deploy in a retry or use `IF NOT EXISTS` to mask an invalid
index. `ALTER TABLE ASYNC ... VALIDATE CONSTRAINT` needs an explicit job wait;
the adapter's automatic setting is documented for `CREATE INDEX ASYNC` only.
Add/test a suitable callback before introducing other asynchronous DDL.

New schema changes must support the currently running Lambda because migrations
precede code deployment. Add new structures first, migrate application usage,
then remove old structures in a later release.

## Validation

CI compiles the pinned adapter and connector into an executable JAR, tests the
deployment failure paths, and runs database integration tests against disposable
PostgreSQL 16. Those tests exercise fresh install, no-op reruns, read-only plans,
adoption, checksum errors, schema drift, and DDL failure. For these tests only,
`INDEX ASYNC` is translated to PostgreSQL `INDEX`; they do **not** prove DSQL
transaction semantics or asynchronous job behavior. Existing auth Jest tests
continue to use the original PostgreSQL migrations.

Local tests:

```bash
node --test apps/auth/scripts/deploy.test.mjs
# Use a disposable PostgreSQL DB named auth_migrations_test, with user postgres
# and password migration-test. The tests drop schemas in this database.
TEST_DATABASE_URL=jdbc:postgresql://localhost:5432/auth_migrations_test \
  mvn -B -ntp -f apps/auth/flyway/pom.xml verify
```

Before enabling automatic production deployment, validate on a disposable DSQL
staging cluster with synthetic data:

- Fresh install, a second no-op run, and adoption of a legacy-shaped database.
- Successful asynchronous indexes and a failed unique-index build; Lambda must
  not update on failure, and the failure must remain visible on the next run.
- Interruption between DDL and the history write, followed by inspection and
  documented recovery; do not assume the run is atomic.
- Backup failure, timeout, and restoring a completed backup to a new cluster.
- A deliberately mismatched Lambda/cluster/account configuration.

## Recovery

A migration failure leaves the old Lambda code running, but earlier DDL may
already be committed. Inspect Flyway history, the actual schema, and `sys.jobs`
before retrying. DDL and migration-history writes cannot form one DSQL
transaction: a crash can leave an applied statement unrecorded, or history that
needs reconciliation. There is no automatic repair or rollback command here.

An unsuccessful async index may remain `INVALID`; a timed-out wait may also hide
a job that later succeeds. Confirm its final state before any targeted cleanup.
Record an operator-reviewed recovery or forward migration rather than repeatedly
rerunning a failed deployment. Do not delete/rewrite history merely to silence a
checksum error.

The workflow summary records the pre-migration recovery point. AWS Backup
restores DSQL into a **new cluster**, not over the old one. A restore therefore
requires a reviewed endpoint/IAM/configuration cutover in Terraform and matching
GitHub variables. Restoring an older backup can omit writes made after it; plan
write handling and data reconciliation before cutover. A Lambda code rollback
alone does not reverse schema changes.

## References

- [AWS Flyway DSQL adapter](https://github.com/awslabs/aurora-dsql-tools/tree/main/flyway)
- [DSQL DDL transactions](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html)
- [DSQL asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html)
- [AWS Backup DSQL support](https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-aurora.html)
- [DSQL restore](https://docs.aws.amazon.com/aws-backup/latest/devguide/restore-auroradsql.html)
- [GitHub OIDC for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
