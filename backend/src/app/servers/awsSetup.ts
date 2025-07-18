import AWS from 'aws-sdk'

export const setupFinished = new Promise<void>((resolve) => {
  const secretsManager = new AWS.SecretsManager({
    region: process.env.AWS_REGION,
  })

  const secrets = Object.entries(process.env).filter(
    ([key, value]) => key.startsWith('AWS_SECRET_') && value !== undefined,
  ) as [string, string][]

  const promises = secrets.map(async ([key, SecretId]) => {
    return new Promise((resolve) => {
      secretsManager.getSecretValue({ SecretId }, (err, data) => {
        if (err) {
          throw err
        }
        const realKey = key.replace('AWS_SECRET_', '')
        process.env[realKey] = data.SecretString
        resolve(true)
      })
    })
  })

  Promise.all(promises).then(() => {
    resolve()
  })
})
