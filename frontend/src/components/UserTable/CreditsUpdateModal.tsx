"use client";

import {
  Transition,
  Dialog,
  TransitionChild,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ApiService } from "../../services/api";
import toast from "react-hot-toast";

export const CreditsUpdateModal = ({
  userHandle,
  onClose,
}: {
  userHandle: string | null;
  onClose: () => void;
}) => {
  const [downloadCredits, setDownloadCredits] = useState<string>("");
  const [downloadCreditsUnit, setDownloadCreditsUnit] = useState<number>(
    1024 ** 2
  );
  const [uploadCredits, setUploadCredits] = useState<string>("");
  const [uploadCreditsUnit, setUploadCreditsUnit] = useState<number>(1024 ** 2);

  useEffect(() => {
    setDownloadCredits("");
    setUploadCredits("");
    setDownloadCreditsUnit(1024 ** 2);
    setUploadCreditsUnit(1024 ** 2);
  }, [userHandle]);

  const updateCredits = useCallback(async () => {
    if (userHandle && downloadCredits && uploadCredits) {
      const downloadBytes = Number(downloadCredits) * downloadCreditsUnit;
      const uploadBytes = Number(uploadCredits) * uploadCreditsUnit;
      await ApiService.updateSubscription(
        userHandle,
        "monthly",
        uploadBytes,
        downloadBytes
      );
      onClose();
      toast.success("Credits updated");
    }
  }, [
    userHandle,
    downloadCredits,
    downloadCreditsUnit,
    uploadCredits,
    uploadCreditsUnit,
  ]);

  const validCredits = useMemo(() => {
    return (
      downloadCredits &&
      !isNaN(Number(downloadCredits)) &&
      uploadCredits &&
      !isNaN(Number(uploadCredits))
    );
  }, [downloadCredits, uploadCredits]);

  return (
    <Transition appear show={!!userHandle} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <DialogTitle
                  as="h3"
                  className="text-lg font-medium leading-6 text-gray-900"
                >
                  Update credits
                </DialogTitle>
                <div className="mt-2">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        className="border border-gray-300 rounded px-2 py-1 w-full"
                        placeholder="Download credits"
                        value={downloadCredits}
                        onChange={(e) => setDownloadCredits(e.target.value)}
                      />
                      <select
                        className="border border-gray-300 rounded px-2 py-1"
                        value={downloadCreditsUnit}
                        onChange={(e) =>
                          setDownloadCreditsUnit(Number(e.target.value))
                        }
                      >
                        <option value={1024 ** 2}>MB</option>
                        <option value={1024 ** 3}>GB</option>
                        <option value={1024 ** 4}>TB</option>
                      </select>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        className="border border-gray-300 rounded px-2 py-1 w-full"
                        placeholder="Upload credits"
                        value={uploadCredits}
                        onChange={(e) => setUploadCredits(e.target.value)}
                      />
                      <select
                        className="border border-gray-300 rounded px-2 py-1"
                        value={uploadCreditsUnit}
                        onChange={(e) =>
                          setUploadCreditsUnit(Number(e.target.value))
                        }
                      >
                        <option value={1024 ** 2}>MB</option>
                        <option value={1024 ** 3}>GB</option>
                        <option value={1024 ** 4}>TB</option>
                      </select>
                    </div>
                    <div className="flex justify-end">
                      <button
                        className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={updateCredits}
                        disabled={!validCredits}
                      >
                        Update
                      </button>
                    </div>
                  </div>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
