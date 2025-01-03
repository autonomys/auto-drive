'use client';

import { FC, useCallback, useState } from 'react';
import { LandingHeader } from '../common/LandingHeader';
import { faqs } from '../../constants/faqs';

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
                className='dark:bg-boxDark w-full rounded-lg bg-white p-8 text-left text-gray-900 shadow-md dark:border-none dark:text-white'
                onClick={() => toggleFAQ(index)}
              >
                <span className='font-semibold'>
                  {index + 1}. {question.question}
                </span>
                <span className='float-right'>
                  {openIndex === index ? '▲' : '▼'}
                </span>
              </button>
              {openIndex === index && (
                <div className='mt-2 rounded-lg bg-gray-100 p-4 dark:bg-gray-700'>
                  <p className='whitespace-pre-line text-gray-700 dark:text-white'>
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
