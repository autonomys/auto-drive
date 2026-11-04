## Releases

### Backend

- Build: Merging to `main` builds and pushes a new Docker image.
- Deploy: Use GH action `Deploy Auto Drive Backend` to update the service image on target machines.
- Environment: Manage runtime secrets in the Infisical Auto-Drive project; the playbook exports them to the `.env` used by Docker Compose.

### Auth

- Runs on AWS Lambda.
- Build: `yarn workspace auth lambda:build` generates `apps/auth/build/index.js`; zip it and upload to the Lambda function.
- Details: See the Auth Service documentation for full steps and context: [Auth Service documentation](./auth.md).

### Database migrations

Production doesn't run migrations on deploy. Apply them by hand before the code that needs them, and follow the PR's deploy notes for the order.

- **Backend:** run `yarn backend db-migrate up` against the production backend database. The production services start without `start-server.sh`, so its `db-migrate up` doesn't run.
- **Auth:** the production database is Aurora DSQL. The migration files are written for Postgres, which dev, CI and the test image use, so apply the PR's DSQL statements by hand. On DSQL:
  - a transaction can hold only one DDL statement, and DDL can't share a transaction with data changes;
  - indexes are created with `CREATE [UNIQUE] INDEX ASYNC`, and you watch `sys.jobs` until the job completes;
  - `ADD COLUMN` takes only a name and a type;
  - `CHECK` and foreign key constraints are added `NOT VALID`;
  - a transaction can change at most 3,000 rows.

### Frontend

- Deployments are triggered by updates to the `production` branch.
- To release: open a PR from `main` to `production`, wait for CI/CD to pass, then merge the PR.
