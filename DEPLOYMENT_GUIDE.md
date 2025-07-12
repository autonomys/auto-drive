# Auto Drive Deployment Guide

## Overview

This guide provides comprehensive instructions for managing deployments of the Auto Drive system using Ansible scripts. The deployment infrastructure supports multiple environments and components across different networks (Mainnet and Taurus) with various configurations.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Target Machine Tags](#target-machine-tags)
3. [Prerequisites](#prerequisites)
4. [Environment Setup](#environment-setup)
5. [Deployment Procedures](#deployment-procedures)
6. [Service Components](#service-components)
7. [Configuration Management](#configuration-management)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

## Architecture Overview

The Auto Drive system consists of two main components:

1. **Auto Drive Services**: Main storage and data access layer services
2. **Files Gateway Services**: Unified gateway for file access across networks
3. **Multinetwork Gateway**: Connects and manages multiple networks

## Target Machine Tags

### Auto Drive Services

#### Production Environments
- **`auto_drive_mainnet_private`**: Private mainnet deployment for internal services
- **`auto_drive_mainnet_public`**: Public mainnet deployment for external access
- **`auto_drive_taurus_private`**: Private taurus testnet deployment
- **`auto_drive_taurus_public`**: Public taurus testnet deployment

#### Staging Environments
- **`auto_drive_mainnet_staging`**: Staging environment for mainnet testing
- **`auto_drive_taurus_staging`**: Staging environment for taurus testing

#### Gateway Services
- **`auto_drive_multinetwork_gateway`**: Unified gateway connecting multiple networks

### Files Gateway Services

#### Staging Environments
- **`files_gateway_taurus_staging`**: Files gateway staging on taurus network
- **`files_gateway_mainnet_staging`**: Files gateway staging on mainnet

#### Production Environments
- **`files_gateway_taurus_production`**: Files gateway production on taurus network
- **`files_gateway_mainnet_production`**: Files gateway production on mainnet

## Prerequisites

### System Requirements
- **Ansible**: Version 2.9 or later
- **Docker**: Installed on target machines
- **Docker Compose**: Version 2.0 or later
- **Infisical CLI**: For secrets management
- **SSH Access**: To all target machines

### Dependencies Installation
```bash
# Install Ansible
pip install ansible

# Install required Ansible collections
ansible-galaxy collection install ansible.posix
ansible-galaxy collection install community.general
```

### Target Machine Setup
All target machines must have:
- Docker and Docker Compose installed
- SSH access configured
- Infisical CLI installed (automatically handled by setup playbook)
- Deployment directories created:
  - `~/deploy/auto-drive/`
  - `~/deploy/auto-drive/gateway/`
  - `~/env-archives/`

## Environment Setup

### 1. Create Environment Configuration

Create an `environment.yaml` file in the `ansible/` directory:

```yaml
# Infisical Configuration
infisical_client_id: "your-client-id"
infisical_token: "your-client-secret"
infisical_project_id: "your-project-id"

# Additional environment-specific variables
```

### 2. Configure Inventory File

The `hosts.ini` file is already created in the `ansible/` directory with all target machine tags. Update it with your actual host information:

1. **Uncomment and configure hosts** as needed for your environment
2. **Replace placeholder IP addresses** with actual values
3. **Adjust hostnames** to match your infrastructure

Example configuration:
```ini
[auto_drive_mainnet_private]
mainnet-private-1 ansible_host=10.0.1.10 ansible_user=ubuntu
mainnet-private-2 ansible_host=10.0.1.11 ansible_user=ubuntu

[auto_drive_mainnet_public]
mainnet-public-1 ansible_host=10.0.2.10 ansible_user=ubuntu
```

The inventory includes:
- **Individual target machine groups** for each service
- **Logical groupings** (production, staging, mainnet, taurus)
- **Environment-specific variables** for each group
- **Common variables** for all hosts

### 3. Ansible Configuration

The `ansible.cfg` file is configured to use the `hosts.ini` inventory and includes optimized settings for deployment operations.

## Deployment Procedures

### 1. Initial Setup

First, set up Infisical on all target machines:

```bash
# Setup Infisical on specific target machines
ansible-playbook setup-infisical.yml -e "target_machines=auto_drive_mainnet_private"

# Setup Infisical on all machines
ansible-playbook setup-infisical.yml -e "target_machines=all"
```

### 2. Auto Drive Services Deployment

Deploy to specific environments:

```bash
# Deploy to mainnet private
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_mainnet_private" \
  -e "image_tag=latest"

# Deploy to mainnet public
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_mainnet_public" \
  -e "image_tag=v1.2.3"

# Deploy to taurus private
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_taurus_private" \
  -e "image_tag=latest"

# Deploy to taurus public
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_taurus_public" \
  -e "image_tag=v1.2.3"

# Deploy to staging environments
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_mainnet_staging" \
  -e "image_tag=staging-latest"

ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_taurus_staging" \
  -e "image_tag=staging-latest"
```

### 3. Multinetwork Gateway Deployment

Deploy the multinetwork gateway:

```bash
# Deploy multinetwork gateway
ansible-playbook auto-drive-multinetwork-gateway.yml \
  -e "image_tag=gateway-v1.0.0"
```

### 4. Files Gateway Services Deployment

For files gateway services, use the main deployment playbook with appropriate target machines:

```bash
# Deploy files gateway staging
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=files_gateway_taurus_staging" \
  -e "image_tag=files-gateway-staging"

ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=files_gateway_mainnet_staging" \
  -e "image_tag=files-gateway-staging"

# Deploy files gateway production
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=files_gateway_taurus_production" \
  -e "image_tag=files-gateway-v1.0.0"

ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=files_gateway_mainnet_production" \
  -e "image_tag=files-gateway-v1.0.0"
```

### 5. Batch Deployments

Deploy to multiple environments simultaneously:

```bash
# Deploy to all staging environments
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_mainnet_staging,auto_drive_taurus_staging" \
  -e "image_tag=staging-latest"

# Deploy to all production environments
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_mainnet_private,auto_drive_mainnet_public,auto_drive_taurus_private,auto_drive_taurus_public" \
  -e "image_tag=v1.2.3"
```

### 6. Group-Based Deployments

Use the logical groupings defined in the inventory:

```bash
# Deploy to all auto drive production environments
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_production" \
  -e "image_tag=v1.2.3"

# Deploy to all staging environments
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_staging" \
  -e "image_tag=staging-latest"

# Deploy to all mainnet services
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=mainnet_services" \
  -e "image_tag=mainnet-v1.0.0"

# Deploy to all taurus services
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=taurus_services" \
  -e "image_tag=taurus-v1.0.0"

# Deploy to all files gateway production
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=files_gateway_production" \
  -e "image_tag=files-gateway-v1.0.0"
```

## Service Components

### Auto Drive Services

The main Auto Drive deployment includes:

- **Hasura GraphQL Engine**: Database interface and API
- **Backend API**: Main application API
- **Backend Worker**: Background processing
- **Backend Download API**: File download handling
- **Backend Download Worker**: Download processing
- **RabbitMQ**: Message queue (optional profile)
- **New Relic Agent**: Monitoring

### Docker Compose Profiles

Services are organized into profiles:

- **base**: Core services (Hasura, New Relic)
- **frontend**: Frontend-related services (API, Worker)
- **download**: Download-related services (API, Worker)
- **rabbit**: RabbitMQ message queue

### Multinetwork Gateway

The gateway service provides:

- **Unified API**: Single interface for multiple networks
- **File Access**: GET `/file/:cid` for file retrieval
- **Folder Access**: GET `/folder/:cid` for folder retrieval
- **Health Checks**: Monitoring endpoints

## Configuration Management

### Infisical Integration

The deployment uses Infisical for secrets management:

1. **Authentication**: Universal auth with client ID/secret
2. **Secret Storage**: Environment-specific paths in Infisical
3. **Configuration Paths**:
   - Auto Drive: `/[target_machines]` (e.g., `/auto_drive_mainnet_private`)
   - Gateway: `/auto_drive_multinetwork_gateway`

### Environment Variables

Key environment variables managed through Infisical:

- `BACKEND_IMAGE`: Docker image for backend services
- `GATEWAY_IMAGE`: Docker image for gateway service
- `DATABASE_URL`: Database connection string
- `HASURA_GRAPHQL_ADMIN_SECRET`: Hasura admin access
- `HASURA_GRAPHQL_JWT_SECRET`: JWT authentication
- Various port configurations and service settings

### Backup and Archival

The deployment automatically:

- Backs up existing `.env` files before updates
- Creates timestamped backups in `~/env-archives/`
- Maintains deployment history for rollback purposes

## Troubleshooting

### Common Issues

1. **Infisical Authentication Failure**
   ```bash
   # Check Infisical credentials
   infisical login --method=universal-auth --client-id=YOUR_ID --client-secret=YOUR_SECRET
   
   # Verify project access
   infisical secrets --projectId YOUR_PROJECT_ID --path /auto_drive_mainnet_private --env prod
   ```

2. **Docker Compose Failures**
   ```bash
   # Check service logs
   docker compose logs -f [service-name]
   
   # Verify image availability
   docker images | grep [image-name]
   
   # Check resource usage
   docker stats
   ```

3. **SSH Connection Issues**
   ```bash
   # Test SSH connectivity
   ansible all -m ping
   
   # Check specific host
   ansible [hostname] -m ping
   ```

4. **Environment Variable Issues**
   ```bash
   # Check .env file content
   cat ~/deploy/auto-drive/.env
   
   # Verify backup exists
   ls -la ~/env-archives/
   ```

### Debugging Deployment

Enable verbose output:

```bash
# Run with increased verbosity
ansible-playbook auto-drive-deployment.yml \
  -e "target_machines=auto_drive_mainnet_private" \
  -e "image_tag=latest" \
  -vvv
```

Check deployment status:

```bash
# Check running containers
ansible all -m shell -a "docker ps"

# Check service health
ansible all -m shell -a "docker compose ps"
```

## Best Practices

### 1. Deployment Strategy

- **Stage First**: Always deploy to staging environments before production
- **Incremental Rollouts**: Deploy to small subsets of production machines first
- **Health Checks**: Verify service health after each deployment
- **Rollback Plan**: Keep previous image tags for quick rollback

### 2. Security

- **Secret Management**: Use Infisical for all sensitive configuration
- **SSH Keys**: Use SSH keys instead of passwords
- **Network Security**: Ensure proper firewall rules
- **Regular Updates**: Keep base images and dependencies updated

### 3. Monitoring

- **Log Aggregation**: Configure centralized logging (Loki integration included)
- **Health Endpoints**: Monitor service health endpoints
- **Resource Monitoring**: Track CPU, memory, and disk usage
- **Alert Configuration**: Set up alerts for critical failures

### 4. Backup and Recovery

- **Regular Backups**: Schedule regular database and configuration backups
- **Disaster Recovery**: Test recovery procedures regularly
- **Version Control**: Keep deployment configurations in version control
- **Documentation**: Maintain up-to-date deployment documentation

### 5. Performance Optimization

- **Resource Allocation**: Monitor and adjust container resource limits
- **Image Optimization**: Use multi-stage builds for smaller images
- **Caching**: Implement appropriate caching strategies
- **Load Balancing**: Configure load balancing for high availability

## Quick Reference

### Common Commands

```bash
# Check all hosts
ansible all -m ping

# Deploy to staging
ansible-playbook auto-drive-deployment.yml -e "target_machines=auto_drive_mainnet_staging" -e "image_tag=staging-latest"

# Deploy gateway
ansible-playbook auto-drive-multinetwork-gateway.yml -e "image_tag=gateway-latest"

# Setup new machines
ansible-playbook setup-infisical.yml -e "target_machines=new_machine_group"

# Check service status
ansible all -m shell -a "docker compose ps"
```

### Environment Tag Reference

| Tag | Purpose | Network | Environment |
|-----|---------|---------|-------------|
| `auto_drive_mainnet_private` | Private mainnet services | Mainnet | Production |
| `auto_drive_mainnet_public` | Public mainnet services | Mainnet | Production |
| `auto_drive_taurus_private` | Private taurus services | Taurus | Production |
| `auto_drive_taurus_public` | Public taurus services | Taurus | Production |
| `auto_drive_mainnet_staging` | Mainnet staging | Mainnet | Staging |
| `auto_drive_taurus_staging` | Taurus staging | Taurus | Staging |
| `auto_drive_multinetwork_gateway` | Multi-network gateway | Multi | Production |
| `files_gateway_taurus_staging` | Files gateway staging | Taurus | Staging |
| `files_gateway_mainnet_staging` | Files gateway staging | Mainnet | Staging |
| `files_gateway_taurus_production` | Files gateway production | Taurus | Production |
| `files_gateway_mainnet_production` | Files gateway production | Mainnet | Production |

---

For additional support or questions, refer to the project documentation or contact the development team.