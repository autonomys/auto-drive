/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { BuyMoreCreditsButton } from '../../../src/components/atoms/BuyMoreCreditsButton';
import { PurchaseCredits } from '../../../src/components/views/PurchaseCredits';

const pathname = '/mainnet/drive/purchase';
let searchParams = new URLSearchParams();
const router = { push: jest.fn<(url: string, options?: unknown) => void>() };

jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  usePathname: () => pathname,
  useRouter: () => router,
}));
jest.mock('next-auth/react', () => ({
  SessionContext: jest
    .requireActual<typeof import('react')>('react')
    .createContext({
      data: { underlyingProvider: 'google' },
      status: 'authenticated',
    }),
}));
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ network: { id: 'mainnet' } }),
}));
jest.mock('@auto-drive/ui', () => ({
  ...jest.requireActual<typeof import('@auto-drive/ui')>('@auto-drive/ui'),
  Button: ({ children }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button>{children}</button>
  ),
}));
jest.mock('../../../src/components/atoms/InternalLink', () => ({
  InternalLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        router.push(href);
      }}
    >
      {children}
    </a>
  ),
}));
jest.mock(
  '../../../src/components/views/PurchaseCredits/GoogleAuthGate',
  () => ({
    GoogleAuthGate: () => null,
  }),
);

type StepProps = {
  context: Record<string, unknown>;
  onNext?: (data: Record<string, unknown>) => void;
  onBack?: () => void;
  onContextChange?: (data: Record<string, unknown>) => void;
};

const step = (
  name: string,
  { context, onNext, onBack, onContextChange }: StepProps,
) => (
  <div>
    <h1>{name}</h1>
    <output data-testid='purchase-context'>{JSON.stringify(context)}</output>
    {onNext && (
      <button
        onClick={() =>
          onNext(
            name === 'Packages' ? { packageId: 'starter' } : { sizeMB: 100 },
          )
        }
      >
        Next
      </button>
    )}
    {onBack && <button onClick={onBack}>Back</button>}
    {onContextChange && (
      <button onClick={() => onContextChange({ paymentMethod: 'usdc_eth' })}>
        Pay with USDC
      </button>
    )}
  </div>
);

jest.mock(
  '../../../src/components/views/PurchaseCredits/steps/Step1_SelectPackage',
  () => ({
    PurchaseStep1SelectPackage: (props: StepProps) => step('Packages', props),
  }),
);
jest.mock(
  '../../../src/components/views/PurchaseCredits/steps/Step2_ConfirmPurchase',
  () => ({
    PurchaseStep2ConnectWallet: (props: StepProps) => step('Confirm', props),
  }),
);
jest.mock(
  '../../../src/components/views/PurchaseCredits/steps/Step3_TransferTokens',
  () => ({
    PurchaseStep3TransferTokens: (props: StepProps) => step('Transfer', props),
  }),
);
jest.mock(
  '../../../src/components/views/PurchaseCredits/steps/Step4_Success',
  () => ({
    PurchaseStep4Success: (props: StepProps) => step('Success', props),
  }),
);

const page = () => (
  <>
    <BuyMoreCreditsButton />
    <PurchaseCredits />
  </>
);
const context = () =>
  JSON.parse(screen.getByTestId('purchase-context').textContent!);
const followNavigation = () => {
  const url = router.push.mock.calls.at(-1)![0];
  searchParams = new URL(url, 'https://example.test').searchParams;
};

describe('purchase navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchParams = new URLSearchParams();
  });

  it.each([2, 3, 4])(
    'Buy more credits resets step %s and clears the previous purchase',
    (currentStep) => {
      searchParams = new URLSearchParams(
        `step=${currentStep}&packageId=pro&sizeMB=1024&paymentMethod=usdc_eth&txHash=0xold`,
      );
      const { rerender } = render(page());
      expect(screen.queryByRole('heading', { name: 'Packages' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Buy more credits' }));
      expect(router.push).toHaveBeenLastCalledWith(pathname);
      followNavigation();
      rerender(page());
      expect(screen.getByRole('heading', { name: 'Packages' })).toBeTruthy();
      expect(context()).toEqual({});
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      followNavigation();
      rerender(page());
      expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy();
      expect(context()).toEqual({ step: 2, packageId: 'starter' });
    },
  );

  it('restores the URL purchase details on browser back and forward', () => {
    const previous =
      'step=2&packageId=starter&sizeMB=100&paymentMethod=ai3_native';
    const next = 'step=3&packageId=pro&sizeMB=1024&paymentMethod=usdc_eth';
    searchParams = new URLSearchParams(next);
    const { rerender } = render(page());
    searchParams = new URLSearchParams(previous);
    rerender(page());
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeTruthy();
    expect(context()).toEqual({
      step: 2,
      packageId: 'starter',
      sizeMB: 100,
      paymentMethod: 'ai3_native',
    });
    searchParams = new URLSearchParams(next);
    rerender(page());
    expect(screen.getByRole('heading', { name: 'Transfer' })).toBeTruthy();
    expect(context()).toEqual({
      step: 3,
      packageId: 'pro',
      sizeMB: 1024,
      paymentMethod: 'usdc_eth',
    });
  });

  it('keeps current selections when advancing and going Back twice', () => {
    const { rerender } = render(page());
    for (const action of ['Next', 'Pay with USDC', 'Next']) {
      fireEvent.click(screen.getByRole('button', { name: action }));
      followNavigation();
      rerender(page());
    }
    expect(screen.getByRole('heading', { name: 'Transfer' })).toBeTruthy();
    expect(context()).toEqual({
      step: 3,
      packageId: 'starter',
      paymentMethod: 'usdc_eth',
      sizeMB: 100,
    });
    for (const heading of ['Confirm', 'Packages']) {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      followNavigation();
      rerender(page());
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
      expect(context().paymentMethod).toBe('usdc_eth');
    }
  });

  it.each(['', 'step=5', 'step=2.5', 'step=invalid'])(
    'returns to packages when no valid step is present (%s)',
    (query) => {
      searchParams = new URLSearchParams('step=3&sizeMB=1024');
      const { rerender } = render(page());
      searchParams = new URLSearchParams(query);
      rerender(page());
      expect(screen.getByRole('heading', { name: 'Packages' })).toBeTruthy();
      expect(context()).not.toHaveProperty('sizeMB');
    },
  );
});
