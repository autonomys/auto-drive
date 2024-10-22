import { ReactNode } from "react";

export const TableHead = ({ children }: { children: ReactNode }) => {
  return (
    <thead className="bg-white text-primary font-semibold rounded-lg">
      {children}
    </thead>
  );
};

export const TableHeadRow = ({ children }: { children: ReactNode }) => {
  return <tr className="border-b border-gray-200 rounded-lg">{children}</tr>;
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
      className={`px-6 py-3 text-left text-xs uppercase tracking-wider rounded-lg ${
        className ?? ""
      }`}
    >
      {children}
    </th>
  );
};
