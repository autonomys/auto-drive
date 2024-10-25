import { useCallback, useEffect, useState } from "react";
import { UploadService } from "../../services/upload";
import { Dialog, Transition } from "@headlessui/react";

export const UploadingFileModal = ({
  file,
  onClose,
}: {
  file: File | null;
  onClose: () => void;
}) => {
  const [progress, setProgress] = useState(50);

  const manageUpload = useCallback(async () => {
    if (!file) return;

    const upload = UploadService.uploadFile(file);
    for await (const chunkProgress of upload) {
      console.log("chunkProgress", chunkProgress);
      setProgress(chunkProgress);
    }

    onClose();
    window.location.reload();
  }, [file]);

  useEffect(() => {
    manageUpload();
  }, [manageUpload]);

  const progressPercentage = Math.round(progress);

  return (
    <Transition show={!!file}>
      <Dialog as="div" onClose={onClose}>
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 shadow-lg transition-transform transform min-w-[25%]">
            <h3 className="text-lg font-medium mb-4 text-center">
              Uploading <strong>{file?.name}</strong>
            </h3>
            <div className="relative w-full h-2 bg-gray-200 rounded">
              <div
                className="absolute top-0 left-0 h-2 bg-green-500 rounded transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-center mt-4 text-sm font-semibold">
              <div>Uploading... {progressPercentage}%</div>
            </div>
            <div className="flex justify-between mt-2">
              <div className="w-1 h-1 bg-gray-500 rounded-full animate-pulse" />
              <div className="w-1 h-1 bg-gray-500 rounded-full animate-pulse" />
              <div className="w-1 h-1 bg-gray-500 rounded-full animate-pulse" />
            </div>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
