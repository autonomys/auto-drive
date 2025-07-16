# GitHub Actions Setup for Ansible Deployments

This document explains how to use the modified Ansible deployment scripts with GitHub Actions in a stateless manner.

## Changes Made

The Ansible scripts have been modified to support both traditional `environment.yaml` file configuration and GitHub Actions environment variables:

### Modified Scripts:

- `auto-drive-deployment.yml` - Main application deployment
- `auto-drive-multinetwork-gateway.yml` - Gateway deployment

### Key Changes:

1. **Hybrid Configuration**: Scripts always load `environment.yaml` first (for local development), then override with environment variables if they exist (for GitHub Actions)
2. **Validation**: Added validation to ensure required variables are present
3. **Full Compatibility**: Local development continues to use `environment.yaml` as normal, while GitHub Actions can override with environment variables

## Required GitHub Secrets

You need to configure the following secrets in your GitHub repository:

### Repository Secrets (Settings > Secrets and Variables > Actions > Repository Secrets):

1. **`INFISICAL_CLIENT_ID`** - Your Infisical universal auth client ID
2. **`INFISICAL_TOKEN`** - Your Infisical universal auth client secret
3. **`INFISICAL_PROJECT_ID`** - Your Infisical project ID
4. **`SSH_PRIVATE_KEY`** - Private SSH key for accessing deployment servers

## GitHub Actions Workflow

The included workflow file (`.github/workflows/deploy.yml`) provides:

### Features:

- **Manual Dispatch**: Trigger deployments manually with parameters
- **Target Selection**: Choose between staging/production environments
- **Image Tag Input**: Specify which Docker image tag to deploy
- **Deployment Type**: Choose between main application or gateway deployment

### Usage:

1. Go to Actions tab in your GitHub repository
2. Select "Deploy Auto Drive" workflow
3. Click "Run workflow"
4. Fill in the required parameters:
   - **Target machines**: staging or production
   - **Image tag**: Docker image tag to deploy
   - **Deployment type**: main or gateway

## Environment Variables

The scripts look for these environment variables:

```bash
INFISICAL_CLIENT_ID=your_client_id
INFISICAL_TOKEN=your_client_secret
INFISICAL_PROJECT_ID=your_project_id
```

## Local Development

For local development, create and use the traditional `environment.yaml` file:

```yaml
# environment.yaml
infisical_client_id: "your_client_id"
infisical_token: "your_client_secret"
infisical_project_id: "your_project_id"
```

Then run playbooks as usual:

```bash
# Run playbook - will use environment.yaml
ansible-playbook auto-drive-deployment.yml -i hosts.ini -e target_machines=staging -e image_tag=latest
```

### Configuration Priority

The scripts load configuration in this order:

1. **Load `environment.yaml`** (if it exists) - for local development
2. **Override with environment variables** (if they exist) - for GitHub Actions
3. **Validate** that all required variables are present

This means:

- **Local development**: Use `environment.yaml` - works exactly as before
- **GitHub Actions**: Environment variables will override any values from `environment.yaml`

## Workflow Customization

You can customize the GitHub Actions workflow by:

1. **Adding more environments**: Modify the `target_machines` choices in the workflow
2. **Adding pre/post deployment steps**: Add additional steps to the workflow
3. **Notification integration**: Add Slack/Teams/Discord notifications
4. **Approval gates**: Add manual approval steps for production deployments

## Security Considerations

- Never commit secrets to the repository
- Use GitHub's encrypted secrets for sensitive information
- Consider using environment-specific secrets for different deployment targets
- Regularly rotate your Infisical credentials

## Troubleshooting

### Common Issues:

1. **Missing secrets**: Ensure all required secrets are configured in GitHub
2. **SSH connectivity**: Verify SSH private key has access to target servers
3. **Infisical authentication**: Check that Infisical credentials are valid and have proper permissions
4. **Ansible inventory**: Ensure `hosts.ini` file is properly configured for your target machines

### Debug Steps:

1. Check GitHub Actions logs for detailed error messages
2. Verify environment variables are being set correctly
3. Test Infisical authentication manually
4. Validate SSH connectivity to target servers
