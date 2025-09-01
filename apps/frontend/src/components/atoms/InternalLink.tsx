'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { handleEnterOrSpace } from 'utils/eventHandler';

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
    <Link
      href={href}
      role='button'
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={handleEnterOrSpace(() => router.push(href))}
      className={`contents ${className}`}
    >
      {children}
    </Link>
  );
};
