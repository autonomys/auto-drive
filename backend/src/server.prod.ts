import AWS from 'aws-sdk'
import { env } from './utils/misc.js'

async function main() {
  const secretsManager = new AWS.SecretsManager({
    region: env('AWS_REGION'),
  })

  const secrets = Object.entries(process.env).filter(
    ([key, value]) => key.startsWith('AWS_SECRET_') && value !== undefined,
  ) as [string, string][]

  secrets.forEach(([key, SecretId]) => {
    secretsManager.getSecretValue({ SecretId }, (err, data) => {
      if (err) {
        throw err
      }
      const realKey = key.replace('AWS_SECRET_', '')
      process.env[realKey] = data.SecretString
    })
  })

  await import('./server.js')
}

main()
