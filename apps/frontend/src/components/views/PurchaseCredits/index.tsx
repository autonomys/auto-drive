'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SessionContext } from 'next-auth/react';
import { ROUTES } from '@auto-drive/ui';
import { useNetwork } from '../../../contexts/network';
import { PurchaseStep1SelectPackage } from './steps/Step1_SelectPackage';
import { PurchaseStep2ConnectWallet } from './steps/Step2_ConfirmPurchase';
import { PurchaseStep3TransferTokens } from './steps/Step3_TransferTokens';
import { PurchaseStep4Success } from './steps/Step4_Success';
import { GoogleAuthGate } from './GoogleAuthGate';
import { StepDefinition } from './molecules/Stepper';

export type PurchaseStep = 1 | 2 | 3 | 4 | 5;

export const PurchaseCredits = () => {
  const [currentStep, setCurrentStep] = useState<PurchaseStep>(1);
  const [context, setContext] = useState<Record<string, unknown>>({});
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { network } = useNetwork();

  // Purchasing requires a Google-verified account. The screen is open to
  // everyone so packages are discoverable, but only Google users may advance
  // past package selection. We gate here (not in Step 1) so the rule also
  // covers deep-links to later steps via ?step=.
  const session = useContext(SessionContext);
  const isGoogleAuthed = session?.data?.underlyingProvider === 'google';
  // Wait for the session to resolve before enforcing — otherwise a Google user
  // refreshing on a later step would be bounced to step 1 during loading.
  const authResolved =
    session?.status === 'authenticated' ||
    session?.status === 'unauthenticated';

  const [authGateOpen, setAuthGateOpen] = useState(false);
  // The package the user picked, awaiting an auth decision. Stored as a fresh
  // object per click so re-picking the same package still re-triggers the
  // handler effect below.
  const [pendingSelection, setPendingSelection] = useState<{
    packageId?: string;
  } | null>(null);

  // Return the user to the purchase flow (with their package preselected) after
  // Google OAuth, rather than the default drive view.
  const authGateCallbackUrl = pendingSelection?.packageId
    ? `${ROUTES.purchase(network.id)}?step=2&packageId=${pendingSelection.packageId}`
    : ROUTES.purchase(network.id);

  const navigateWithParams = useCallback(
    (changes: Record<string, unknown>) => {
      const params = new URLSearchParams(searchParams?.toString());
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });
      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    },
    [searchParams, router, pathname],
  );

  // Initialize from query params (e.g., ?step=2&packageId=pro)
  useEffect(() => {
    if (!searchParams) return;

    const newContext: Record<string, unknown> = {};
    // Copy all query params into context, number-coercing simple numerics
    searchParams.forEach((value, key) => {
      const numericValue = Number(value);
      newContext[key] =
        Number.isFinite(numericValue) &&
        value.trim() !== '' &&
        /^-?\d+(\.\d+)?$/.test(value)
          ? numericValue
          : value;
    });

    if (Object.keys(newContext).length > 0) {
      setContext((prev) => ({ ...newContext, ...prev }));
    }

    const stepParamRaw = searchParams.get('step');
    const stepParam = stepParamRaw ? Number(stepParamRaw) : undefined;
    if (stepParam && stepParam >= 1 && stepParam <= 5) {
      setCurrentStep(stepParam as PurchaseStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.toString()]);

  // Enforce the Google gate at render: non-Google users (once auth resolves)
  // can never see beyond package selection, regardless of how `currentStep`
  // was reached (deep-link, ?step=, back/forward). The gate modal handles the
  // actual sign-in prompt when they try to advance.
  const effectiveStep: PurchaseStep =
    authResolved && !isGoogleAuthed && currentStep > 1 ? 1 : currentStep;

  // Act on a pending package selection, but only once the session has resolved.
  // Deferring keeps this consistent with `effectiveStep`: a still-loading
  // session is never treated as non-Google, so Google users don't get the
  // sign-in gate during the brief load window after SessionEnsurer renders.
  useEffect(() => {
    if (!pendingSelection || !authResolved) return;
    if (isGoogleAuthed) {
      setContext((prev) => ({ ...prev, ...pendingSelection }));
      setCurrentStep(2);
      navigateWithParams({ ...pendingSelection, step: 2 });
      setPendingSelection(null);
      // Close the gate in case it was opened earlier and the session has since
      // become Google-authenticated (e.g. signed in from another tab).
      setAuthGateOpen(false);
    } else {
      // Resolved non-Google → prompt sign-in. Keep pendingSelection so the
      // gate's callbackUrl retains the chosen package.
      setAuthGateOpen(true);
    }
  }, [pendingSelection, authResolved, isGoogleAuthed, navigateWithParams]);

  const onBack = useCallback(() => {
    const newStep = Math.max(1, currentStep - 1);
    setCurrentStep(newStep as PurchaseStep);
    navigateWithParams({ step: newStep });
  }, [currentStep, navigateWithParams]);

  const steps: StepDefinition[] = useMemo(
    () => [
      {
        id: 1,
        title: 'Buy Credits',
        component: (
          <PurchaseStep1SelectPackage
            onNext={(data) => {
              // Record the selection; the handler effect advances (Google) or
              // opens the sign-in gate (non-Google) once the session resolves.
              setPendingSelection({
                packageId:
                  typeof data.packageId === 'string'
                    ? data.packageId
                    : undefined,
              });
            }}
            context={context}
          />
        ),
      },
      {
        id: 2,
        title: 'Complete Payment',
        component: (
          <PurchaseStep2ConnectWallet
            onContextChange={(data) => {
              setContext((prev) => ({ ...prev, ...data }));
              navigateWithParams({ ...data });
            }}
            onNext={(data) => {
              setContext((prev) => ({ ...prev, ...data }));
              setCurrentStep(3);
              navigateWithParams({ ...data, step: 3 });
            }}
            onBack={onBack}
            context={context}
          />
        ),
      },
      {
        id: 3,
        title: 'Transfer AI3',
        component: (
          <PurchaseStep3TransferTokens
            onNext={(data) => {
              setContext((prev) => ({ ...prev, ...data }));
              setCurrentStep(4);
              navigateWithParams({ ...data, step: 4 });
            }}
            onBack={() => {
              setCurrentStep(2);
              navigateWithParams({ step: 2 });
            }}
            context={context}
          />
        ),
      },
      {
        id: 4,
        title: 'Payment Successful',
        component: <PurchaseStep4Success context={context} />,
      },
    ],
    // Intentionally exclude navigateWithParams from deps to avoid re-render loop
    // as it's a stable function over the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context],
  );

  return (
    <div className='flex flex-col gap-4'>
      <GoogleAuthGate
        isOpen={authGateOpen}
        onClose={() => {
          // Dismissing the prompt discards the pending selection too —
          // otherwise a later switch to a Google session would auto-advance
          // the wizard as if the user had confirmed.
          setAuthGateOpen(false);
          setPendingSelection(null);
        }}
        callbackUrl={authGateCallbackUrl}
      />
      {steps.find((s) => s.id === effectiveStep)?.component}
    </div>
  );
};
