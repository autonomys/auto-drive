'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PurchaseStep1SelectPackage } from './steps/Step1_SelectPackage';
import { PurchaseStep2ConnectWallet } from './steps/Step2_ConfirmPurchase';
import { PurchaseStep3TransferTokens } from './steps/Step3_TransferTokens';
import { PurchaseStep4Success } from './steps/Step4_Success';
import { StepDefinition } from './molecules/Stepper';

export type PurchaseStep = 1 | 2 | 3 | 4 | 5;

export const PurchaseCredits = () => {
  const [currentStep, setCurrentStep] = useState<PurchaseStep>(1);
  const [context, setContext] = useState<Record<string, unknown>>({});
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

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
              setContext((prev) => ({ ...prev, ...data }));
              setCurrentStep(2);
              navigateWithParams({ ...data, step: 2 });
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
      {steps.find((s) => s.id === currentStep)?.component}
    </div>
  );
};
