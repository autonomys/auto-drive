## Releases

### Backend

- Build: Merging to `main` builds and pushes a new Docker image.
- Deploy: Use GH action `Deploy Auto Drive Backend` to update the service image on target machines.
- Environment: Manage runtime secrets in the Infisical Auto-Drive project; the playbook exports them to the `.env` used by Docker Compose.

### Auth

- Runs on AWS Lambda.
- Build: `yarn workspace auth lambda:build` generates `apps/auth/build/index.js`; zip it and upload to the Lambda function.
- Details: See the Auth Service documentation for full steps and context: [Auth Service documentation](./auth.md).

### Frontend

- Deployments are triggered by updates to the `production` branch.
- To release: open a PR from `main` to `production`, wait for CI/CD to pass, then merge the PR.
