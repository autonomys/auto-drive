import express, { Router } from 'express'
import { swagger } from '../../docs/reference/index.js'
import { docsView } from '../../docs/view.js'

export const docsController = Router()

docsController.get('/', (req, res) => {
  res.send(docsView)
})

docsController.get('/raw', (req, res) => {
  res.json(swagger)
})

const app = express()

app.use('/docs', docsController)

app.listen(3000, () => {
  console.log('Docs server is running on port 3000')
})
