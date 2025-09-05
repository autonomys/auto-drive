import { Response } from 'express'
import js2xmlparser from 'js2xmlparser'

export const sendXML = <T extends object>(
  res: Response,
  rootName: string,
  json: T,
) => {
  res.setHeader('Content-Type', 'application/xml')

  res.send(js2xmlparser.parse(rootName, json))
}
