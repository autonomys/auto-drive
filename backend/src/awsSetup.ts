import AWS from 'aws-sdk'

if (process.env.NODE_ENV === 'production') {
  const secretsManager = new AWS.SecretsManager({
    region: process.env.AWS_REGION,
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
}
