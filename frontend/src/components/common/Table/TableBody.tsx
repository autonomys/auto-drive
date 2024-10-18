import { ReactNode } from "react";

export const TableBody = ({ children }: { children: ReactNode }) => {
  return <tbody>{children}</tbody>;
};

export const TableBodyRow = ({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) => {
  return (
    <tr
      className={`hover:bg-gray-100 border border-gray-200 ${className ?? ""}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
};

export const TableBodyCell = ({
  children,
  className,
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) => {
  return (
    <td
      className={`px-6 py-4 text-sm text-primary ${className ?? ""}`}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
};
