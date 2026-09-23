import { PaymentMethod } from '@auto-drive/models';
import {
  describePayment,
  suggestedRefund,
  type RefundSizingFields,
} from '../../../src/utils/credits';

const ai3Batch: RefundSizingFields = {
  paymentMethod: PaymentMethod.AI3_NATIVE,
  paymentAmount: '10000000000000000000',
  tokenAmount: null,
  quotedTokenAmount: null,
  quotedAi3Shannons: null,
  uploadBytesOriginal: '1000',
  uploadBytesRemaining: '500',
  shannonsPerByte: '10000000000000000',
};

// 2 USDC bought 10 AI3 of storage. The effective purchase rate, including
// margin, is 0.20 USDC/AI3.
const usdcBatch: RefundSizingFields = {
  ...ai3Batch,
  paymentMethod: PaymentMethod.USDC_ETH,
  paymentAmount: null,
  tokenAmount: '2000000',
  quotedTokenAmount: '2000000',
  quotedAi3Shannons: '10000000000000000000',
};

describe('describePayment', () => {
  it('shows the original USDC payment and the effective purchase rate', () => {
    expect(describePayment(usdcBatch)).toEqual({
      amountPaid: '2.00 USDC',
      quotedFor: '10 AI3',
      offQuoteNote: null,
      rate: '0.200000',
    });
  });

  it('retains the received amount and mismatch notice for off-quote payments', () => {
    expect(describePayment({ ...usdcBatch, tokenAmount: '1000000' })).toEqual({
      amountPaid: '1.00 USDC',
      quotedFor: '10 AI3',
      offQuoteNote: 'Quoted 2.00 USDC, received 1.00 USDC — credited pro-rata',
      rate: '0.200000',
    });
  });

  it('shows native AI3 payments without conversion details', () => {
    expect(describePayment(ai3Batch)).toEqual({
      amountPaid: '10 AI3',
      quotedFor: null,
      offQuoteNote: null,
      rate: null,
    });
  });
});

describe('suggestedRefund', () => {
  it('refunds unused native AI3 storage at its locked byte price', () => {
    expect(suggestedRefund([ai3Batch])).toBe('5 AI3');
  });

  it('converts USDC at the effective purchase rate before taking the unused share', () => {
    expect(suggestedRefund([usdcBatch])).toBe('5 AI3');
    expect(
      suggestedRefund([{ ...usdcBatch, uploadBytesRemaining: '1000' }]),
    ).toBe('10 AI3');
  });

  it.each([
    ['underpayment', '1000000', '500', '250', '2.5 AI3'],
    ['overpayment', '4000000', '2000', '1000', '10 AI3'],
  ])(
    'uses the USDC actually received for an %s',
    (
      _label,
      tokenAmount,
      uploadBytesOriginal,
      uploadBytesRemaining,
      expected,
    ) => {
      expect(
        suggestedRefund([
          {
            ...usdcBatch,
            tokenAmount,
            uploadBytesOriginal,
            uploadBytesRemaining,
          },
        ]),
      ).toBe(expected);
    },
  );

  it('combines AI3 and USDC purchases regardless of ordering', () => {
    expect(suggestedRefund([ai3Batch, usdcBatch])).toBe('10 AI3');
    expect(suggestedRefund([usdcBatch, ai3Batch])).toBe('10 AI3');
  });

  it('uses each purchase’s historical rate in a combined refund', () => {
    expect(
      suggestedRefund([
        usdcBatch,
        {
          ...usdcBatch,
          quotedTokenAmount: '4000000',
          tokenAmount: '2000000',
          uploadBytesOriginal: '500',
          uploadBytesRemaining: '250',
        },
      ]),
    ).toBe('7.5 AI3');
  });

  it.each([
    { tokenAmount: null },
    { quotedTokenAmount: null },
    { quotedAi3Shannons: null },
    { quotedTokenAmount: '0' },
    { quotedAi3Shannons: '0' },
    { uploadBytesOriginal: '0' },
  ])(
    'omits the entire total if conversion data is unavailable: %p',
    (missing) => {
      expect(
        suggestedRefund([ai3Batch, { ...usdcBatch, ...missing }]),
      ).toBeNull();
    },
  );

  it('omits suggestions for empty selections and depleted batches', () => {
    expect(suggestedRefund([])).toBeNull();
    expect(
      suggestedRefund([{ ...usdcBatch, uploadBytesRemaining: '0' }]),
    ).toBeNull();
  });

  it('keeps large base-unit amounts exact', () => {
    expect(
      suggestedRefund([
        {
          ...usdcBatch,
          tokenAmount: '9007199254740993',
          quotedTokenAmount: '3',
          quotedAi3Shannons: '1000000000000000000',
          uploadBytesOriginal: '2',
          uploadBytesRemaining: '1',
        },
      ]),
    ).toBe('1501199875790165.5 AI3');
  });

  it('rounds fractional shannons down after conversion and proration', () => {
    expect(
      suggestedRefund([
        {
          ...usdcBatch,
          tokenAmount: '1',
          quotedTokenAmount: '3',
          quotedAi3Shannons: '1000000000000000000',
          uploadBytesOriginal: '3',
          uploadBytesRemaining: '1',
        },
      ]),
    ).toBe('0.111111111111111111 AI3');
  });
});
