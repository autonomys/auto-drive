'use client';

import { useRouter } from 'next/navigation';

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
    <button
      onClick={() => {
        router.push(href);
      }}
      className={`contents ${className}`}
    >
      {children}
    </button>
  );
};
