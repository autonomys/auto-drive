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
    question: 'Are all files public?',
    answer:
      'Autonomys is a decentralized storage network, so all files are public by default. However, you can encrypt your files before uploading them to ensure they are private.',
  },
  {
    question: 'How data availability is ensured?',
    answer: (
      <span>
        Your file is decomposed into chunks and each chunk is processed by an
        erasure code. This means that if a chunk is lost, the file can be
        reconstructed from the remaining chunks. Additionally, every chunk is
        stored in multiple nodes to ensure data availability.
        <br />
        <br />
        <span>
          The replication factor means how many copies of each erasure-coded
          chunk are stored on-chain. You can check the replication factor of
          your file as the factor between the total pledged storage and the
          current size of the chain in{' '}
          <a href={EXTERNAL_ROUTES.astral} target='_blank' rel='noreferrer'>
            astral explorer.
          </a>
        </span>
        <br />
        <br />
        <span>
          As of{' '}
          <strong>
            {new Date(2025, 1, 1).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </strong>
          , the replication factor of the mainnet is almost 5 millions.
        </span>
      </span>
    ),
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
  {
    question: 'When should I use Auto-Drive mainnet or taurus network?',
    answer: (
      <span>
        Both networks provides the same interface through our SDK so you can
        switch between them but mainnet storage has true permanent storage and a
        much higher replication factor, taurus storage will be eventually shut
        down, obviously with some reasonable notice.
        <br />
        <br />
        If your application needs permanent storage, we recommend using mainnet
        storage else you can use taurus considering that will be a cheaper
        option.
      </span>
    ),
  },
  {
    question: 'Could I participate pledging storage?',
    answer: (
      <span>
        Yes, you can pledge storage to the network and earn rewards. Find more
        about farming{' '}
        <a
          href={EXTERNAL_ROUTES.farmerDocs}
          target='_blank'
          rel='noreferrer'
          className='text-blue-500 transition-all duration-300 hover:text-blue-600 hover:underline'
        >
          here
        </a>
      </span>
    ),
  },
];
