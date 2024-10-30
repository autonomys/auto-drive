import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

export const TablePaginator = ({
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  totalItems,
}: {
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  currentPage: number;
  setCurrentPage: (currentPage: number) => void;
  totalItems: number;
}) => {
  return (
    <div className="flex w-full items-center justify-between p-4 text-light-gray text-sm">
      <div className="flex items-center">
        <span className="mr-2">Items per page:</span>
        <select
          className="border border-gray-300 rounded p-1 bg-gray-100 pr-1"
          value={pageSize}
          onChange={(e) => setPageSize(parseInt(e.target.value))}
        >
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="20">20</option>
        </select>
      </div>
      <div>
        <span>
          {currentPage * pageSize + 1}-
          {Math.min(currentPage * pageSize + pageSize, totalItems)} of{" "}
          {totalItems} items
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={currentPage === 0}
          className="p-2 text-gray-800 cursor-pointer rounded-md border border-light-gray hover:scale-[102%] transition-all disabled:opacity-0"
          onClick={() => setCurrentPage(currentPage - 1)}
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <button
          disabled={currentPage * pageSize + pageSize >= totalItems}
          className="p-2 text-gray-800 cursor-pointer rounded-md border border-light-gray hover:scale-[102%] transition-all disabled:opacity-0"
          onClick={() => setCurrentPage(currentPage + 1)}
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};