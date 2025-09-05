import { Request, Response } from 'express'
import { handleAuth } from './express.js'

export const handleS3Auth = async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization']
  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' })
    return
  }

  const apiKey = authHeader.match(/Credential=([A-Za-z0-9]*)\//)?.[1]
  if (!apiKey) {
    res.status(401).json({ error: 'Missing api key or invalid format' })
    return
  }

  req.headers['x-auth-provider'] = 'apikey'
  req.headers['authorization'] = `Bearer ${apiKey}`

  return handleAuth(req, res)
}
