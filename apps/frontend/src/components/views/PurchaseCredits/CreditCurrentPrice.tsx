import { usePrices } from '../../../hooks/usePrices';

export const CreditCurrentPrice = () => {
  const { ai3PerCreditsMb: mbPricePerAi3 } = usePrices();

  return (
    <div className='rounded-xl bg-primary p-6 text-primary-foreground'>
      <div className='flex flex-col items-start justify-between gap-4 md:flex-row md:items-center'>
        <div>
          <div className='text-sm opacity-90'>Current Price</div>
          <div className='text-3xl font-bold'>
            {typeof mbPricePerAi3 === 'number'
              ? `${mbPricePerAi3} AI3 per MB`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
};
