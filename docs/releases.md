## Releases

### Backend

- Build: Merging to `main` builds and pushes a new Docker image.
- Deploy: Use GitHub action `Deploy Auto Drive Backend` to update the service image on target machines. The GitHub workflow uses Ansible to execute remote scripts. To do this, the workflow generates the hosts.ini file (more details below).
- Environment: Manage runtime secrets in the Infisical Auto-Drive project; the playbook exports them to the `.env` used by Docker Compose.

Ansible playbooks use hosts.ini files ([see example](https://gist.github.com/adaml73/734f7a29f4851baa7b26c53668c1cf69)) to map target machine names to their IPs. Therefore, in GitHub Actions we need to generate them. For this purpose, we inject a secret as base64 ([see workflow](https://github.com/autonomys/auto-drive/blob/main/.github/workflows/auto-drive-backend-deploy.yml)) and decode it when generating the file that will be used by the Ansible playbook.

To update the hosts.ini file, follow these steps:

1. Update `hosts.ini` file
2. Encode in base64 `base64 -i hosts.ini`
3. Copy result and update `HOST_INI_BASE64` secret on `auto-drive` repo

### Auth

- Runs on AWS Lambda.
- Build: `yarn workspace auth lambda:build` generates `apps/auth/build/index.js`; zip it and upload to the Lambda function.
- Details: See the Auth Service documentation for full steps and context: [Auth Service documentation](./auth.md).

### Frontend

- Deployments are triggered by updates to the `production` branch.
- To release: open a PR from `main` to `production`, wait for CI/CD to pass, then merge the PR.
