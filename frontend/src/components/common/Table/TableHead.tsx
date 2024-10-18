import { ReactNode } from "react";

export const TableHead = ({ children }: { children: ReactNode }) => {
  return (
    <thead className="bg-white text-primary font-semibold border border-b-0 border-gray-200 rounded">
      {children}
    </thead>
  );
};

export const TableHeadRow = ({ children }: { children: ReactNode }) => {
  return <tr className="border-b border-gray-200 rounded-t-lg">{children}</tr>;
};

export const TableHeadCell = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <th
      scope="col"
      className={`px-6 py-3 text-left text-xs uppercase tracking-wider ${
        className ?? ""
      }`}
    >
      {children}
    </th>
  );
};
