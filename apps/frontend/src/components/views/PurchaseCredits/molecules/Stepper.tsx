'use client';

import { cn } from '@auto-drive/ui';

export type StepDefinition = {
  id: number;
  title: string;
  component: React.ReactNode;
};

export const Stepper = ({
  steps,
  currentStepId,
}: {
  steps: StepDefinition[];
  currentStepId: number;
}) => {
  return (
    <ol className='flex w-full items-center gap-2 text-sm'>
      {steps.map((step, index) => {
        const isActive = step.id === currentStepId;
        const isCompleted = step.id < currentStepId;
        return (
          <li key={step.id} className='flex items-center'>
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border',
                isCompleted
                  ? 'bg-primary text-white'
                  : 'bg-gray-200 text-gray-500',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-gray-200 text-gray-500',
              )}
            >
              {index + 1}
            </div>
            <span className='ml-2 mr-4 whitespace-nowrap'>{step.title}</span>
          </li>
        );
      })}
    </ol>
  );
};
