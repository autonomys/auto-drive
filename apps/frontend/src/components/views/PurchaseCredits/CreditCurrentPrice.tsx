import { usePrices } from '../../../hooks/usePrices';

const MiB = 1024 ** 2;

export const CreditCurrentPrice = () => {
  const { shannonsPerByte, formatCreditsAsAi3 } = usePrices();

  return (
    <div className='rounded-xl bg-primary p-6 text-primary-foreground'>
      <div className='flex flex-col items-start justify-between gap-4 md:flex-row md:items-center'>
        <div>
          <div className='text-sm opacity-90'>Current Price</div>
          <div className='text-3xl font-bold'>
            {typeof shannonsPerByte === 'number'
              ? `${formatCreditsAsAi3(MiB).toFixed(2)} AI3 per MiB`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
};
