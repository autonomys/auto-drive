/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '../../utils/cn';

export const CopiableText = ({
  text,
  displayText,
  className,
  copyButtonClassName,
}: {
  text: string;
  displayText?: string;
  className?: string;
  copyButtonClassName?: string;
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const onClick = useCallback(() => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 2_000);
  }, [text]);

  const displayingText = displayText ?? text;

  return (
    <button
      type='button'
      className={cn(
        'group relative flex cursor-pointer items-center gap-2',
        className,
      )}
      onClick={onClick}
    >
      <span role='button' tabIndex={0}>
        {displayingText}
      </span>
      <div className='relative'>
        {isCopied ? (
          <Check className='h-4 w-4 text-green-500' />
        ) : (
          <Copy
            className={cn(
              'dark:text-darkBlack h-4 w-4 text-gray-400 hover:text-gray-700 dark:hover:text-gray-100',
              copyButtonClassName,
            )}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          />
        )}
        <div className='pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-gray-700'>
          {isCopied ? 'Copied!' : 'Copy'}
        </div>
      </div>
    </button>
  );
};
