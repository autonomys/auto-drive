import { ReactNode } from "react";

export const TableFooter = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return <tfoot className={className}>{children}</tfoot>;
};
