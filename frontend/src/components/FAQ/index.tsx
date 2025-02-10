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
                className='dark:bg-darkWhite dark:text-darkBlack w-full rounded-lg bg-white p-8 text-left text-backgroundDark shadow-md dark:border-none dark:text-white'
                onClick={() => toggleFAQ(index)}
              >
                <span className='dark:text-darkBlack text-xl font-semibold text-black'>
                  {index + 1}. {question.question}
                </span>
                <span className='float-right'>
                  {openIndex === index ? '▲' : '▼'}
                </span>
              </button>
              {openIndex === index && (
                <div className='dark:bg-darkWhiteHover mt-2 rounded-lg bg-gray-100 p-4'>
                  <p className='dark:text-darkBlack whitespace-pre-line text-black'>
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
