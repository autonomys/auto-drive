'use client';

import { useRouter } from 'next/navigation';
import { handleEnterOrSpace } from '../../utils/eventHandler';

export const InternalLink = ({
  children,
  href,
  className,
}: {
  children: React.ReactNode;
  href: string;
  className?: string;
}) => {
  const router = useRouter();

  return (
    <span
      role='button'
      tabIndex={0}
      onKeyDown={handleEnterOrSpace(() => router.push(href))}
      className={`contents ${className}`}
    >
      {children}
    </span>
  );
};
