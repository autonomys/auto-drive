import { describe, it, expect } from '@jest/globals'
import type { Response } from 'express'
import { sendXML } from '../../../src/app/controllers/s3/utils.js'

const stubRes = () => {
  const state = { body: '' }
  const res = {
    setHeader: () => res,
    send: (body: string) => {
      state.body = body
      return res
    },
  }
  return { res: res as unknown as Response, state }
}

describe('sendXML', () => {
  it('replaces characters XML 1.0 cannot represent in an <Error> document', () => {
    const { res, state } = stubRes()
    sendXML(res, 'Error', {
      Code: 'NoSuchKey',
      Message: 'Object default/a\x19b not found',
      Key: 'a\x00&<b\uFFFFc\td',
    })
    expect(state.body).toContain(
      '<Message>Object default/a\uFFFDb not found</Message>',
    )
    expect(state.body).toContain('<Key>a\uFFFD&amp;&lt;b\uFFFDc\td</Key>')
  })

  it('refuses to rewrite a success body', () => {
    const { res } = stubRes()
    expect(() =>
      sendXML(res, 'ListBucketResult', { NextContinuationToken: 'a\x19b' }),
    ).toThrow()
  })
})
