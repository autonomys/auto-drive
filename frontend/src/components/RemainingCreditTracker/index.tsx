import bytes from "bytes";

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  downloadPending: number;
  downloadLimit: number;
  startDate: string;
  endDate: string;
}

export const RemainingCreditTracker = ({
  uploadPending: uploadUsed = 0,
  uploadLimit = 1000,
  downloadPending = 0,
  downloadLimit = 2000,
  startDate = "Oct 16, 2024",
  endDate = "Nov 16, 2024",
}: CreditLimitsProps) => {
  const uploadPercentage = (uploadUsed / uploadLimit) * 100;
  const downloadPercentage = (downloadPending / downloadLimit) * 100;

  return (
    <div className="w-full max-w-sm mx-auto bg-white rounded-lg overflow-hidden">
      <div className="py-4">
        <div className="space-y-6">
          <div>
            <h2 className="text-sm text-gray-700 font-semibold mb-1">
              Upload Credit Remaining
            </h2>
            <div className="flex justify-between mb-1 text-sm text-gray-600">
              <span>
                <span className="text-gray-700">{bytes(uploadUsed)}</span>/
                <span className="text-gray-500">{bytes(uploadLimit)}</span>
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-slate-500 h-2.5 rounded-full w-32"
                style={{ width: `${uploadPercentage}%` }}
                role="progressbar"
                aria-valuenow={uploadUsed}
                aria-valuemin={0}
                aria-valuemax={uploadLimit}
              ></div>
            </div>
          </div>

          <div>
            <h2 className="text-sm text-gray-700 font-semibold mb-1">
              Download Credit Remaining
            </h2>
            <div className="flex justify-between mb-1 text-sm text-gray-600">
              <span>
                <span className="text-gray-700">{bytes(downloadPending)}</span>/
                <span className="text-gray-500">{bytes(downloadLimit)}</span>
              </span>
              <span>{bytes(downloadLimit)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 w-8">
              <div
                className="bg-slate-500 h-2.5 rounded-full w-full"
                style={{ width: `${downloadPercentage}%` }}
                role="progressbar"
                aria-valuenow={downloadPending}
                aria-valuemin={0}
                aria-valuemax={downloadLimit}
              ></div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-600">Period</span>
          <div className="text-center text-sm text-gray-600 mt-4">
            {startDate} - {endDate}
          </div>
        </div>
      </div>
    </div>
  );
};
