import { ReactNode } from 'react';
import { EXTERNAL_ROUTES } from './routes';

export type FAQ = {
  question: string;
  answer: ReactNode;
};

export const faqs = [
  {
    question: 'Is it free to use Auto-Drive?',
    answer:
      'Yes, it is free but uploads and downloads have a monthly limit in bytes.',
  },
  {
    question: 'Is all data stored on-chain?',
    answer: 'Yes, all data is stored on-chain.',
  },
  {
    question: 'Are all files public?',
    answer:
      'Autonomys is a decentralized storage network, so all files are public by default. However, you can encrypt your files before uploading them to ensure they are private.',
  },
  {
    question: 'Can I use Auto-Drive for creating apps?',
    answer: (
      <span>
        Yes, you can use Auto-Drive for creating apps. Login into your account
        and create an Api Key.
        <br />
        <br />
        <span>
          Find more about building with Auto-Drive{' '}
          <a
            href={EXTERNAL_ROUTES.autoDriveDocs}
            target='_blank'
            rel='noreferrer'
            className='text-blue-500 transition-all duration-300 hover:text-blue-600 hover:underline'
          >
            here
          </a>
        </span>
      </span>
    ),
  },
];
