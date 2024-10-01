"use client";

import { useRouter } from "next/navigation";

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
    <a
      onClick={() => {
        router.push(href);
      }}
      className={`contents ${className}`}
    >
      {children}
    </a>
  );
};
