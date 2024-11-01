import bytes from "bytes";
import { Download, Upload } from "lucide-react";

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  downloadPending: number;
  downloadLimit: number;
  startDate: string;
  endDate: string;
}

export const RemainingCreditTracker = ({
  uploadPending = 0,
  uploadLimit = 1000,
  downloadPending = 0,
  downloadLimit = 2000,
  startDate,
  endDate,
}: CreditLimitsProps) => {
  const uploadUsed = uploadLimit - uploadPending;
  const downloadUsed = downloadLimit - downloadPending;

  const uploadPercentage = (uploadUsed / uploadLimit) * 100;
  const downloadPercentage = (downloadUsed / downloadLimit) * 100;

  return (
    <div className="w-full max-w-sm mx-auto bg-white rounded-lg overflow-hidden">
      <div className="py-4">
        <div className="space-y-6">
          <div>
            <div className="flex justify-between mb-1 text-sm text-gray-600">
              <span>
                <span className="text-primary">{bytes(uploadUsed)}</span>/
                <span className="text-gray-500">{bytes(uploadLimit)}</span>
              </span>
              <span className="text-secondary px-2">
                <Upload className="w-4 h-4" />
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-primary h-2.5 rounded-full w-32"
                style={{ width: `${uploadPercentage}%` }}
                role="progressbar"
                aria-valuenow={uploadUsed}
                aria-valuemin={0}
                aria-valuemax={uploadLimit}
              ></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1 text-sm text-gray-600">
              <span>
                <span className="text-primary">{bytes(downloadUsed)}</span>/
                <span className="text-gray-500">{bytes(downloadLimit)}</span>
              </span>
              <span className="text-secondary px-2">
                <Download className="w-4 h-4" />
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 w-8">
              <div
                className="bg-primary h-2.5 rounded-full w-full"
                style={{ width: `${downloadPercentage}%` }}
                role="progressbar"
                aria-valuenow={downloadUsed}
                aria-valuemin={0}
                aria-valuemax={downloadLimit}
              ></div>
            </div>
          </div>
        </div>
        <div className="flex flex-col text-center mt-2">
          <span className="text-sm text-gray-400">Credit for period</span>
          <div className="text-center text-sm text-gray-600">
            {startDate} - {endDate}
          </div>
        </div>
      </div>
    </div>
  );
};
