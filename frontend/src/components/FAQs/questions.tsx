'use client';

import { FC, useCallback, useState } from 'react';
import { LandingHeader } from 'components/common/LandingHeader';
import { faqs } from 'constants/faqs';

export const FAQ: FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const toggleFAQ = useCallback(
    (index: number) => setOpenIndex(openIndex === index ? null : index),
    [openIndex],
  );

  return (
    <div className='min-h-full w-full'>
      <LandingHeader />
      <div className='mt-8 flex w-full flex-col items-center justify-center'>
        <div className='mt-4 w-[90%] md:w-[60%]'>
          {faqs.map((question, index) => (
            <div key={index} className='m-4'>
              <button
                className='w-full rounded-lg bg-background p-8 text-left text-backgroundDark shadow-md dark:border-none bg-background text-foreground dark:text-white'
                onClick={() => toggleFAQ(index)}
              >
                <span className='text-xl font-semibold text-foreground'>
                  {index + 1}. {question.question}
                </span>
                <span className='float-right'>
                  {openIndex === index ? '▲' : '▼'}
                </span>
              </button>
              {openIndex === index && (
                <div className='mt-2 rounded-lg bg-gray-100 p-4 bg-background'>
                  <p className='whitespace-pre-line text-foreground'>
                    {question.answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
