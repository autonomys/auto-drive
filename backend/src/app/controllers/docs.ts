import { Router } from 'express'
import { swagger } from '../../docs/reference/index.js'
import { docsView } from '../../docs/view.js'

export const docsController = Router()

docsController.get('/', (req, res) => {
  res.send(docsView)
})

docsController.get('/raw', (req, res) => {
  res.json(swagger)
})
