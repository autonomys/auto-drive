import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { UploadedObjectMetadata } from "../../../models/UploadedObjectMetadata";
import { ApiService } from "../../../services/api";
import { HandleSelector } from "../../HandleSearch";

export const ObjectShareModal = ({
  metadata,
  closeModal,
}: {
  metadata: UploadedObjectMetadata | null;
  closeModal: () => void;
}) => {
  const isOpen = metadata !== null;
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const shareObject = useCallback(async () => {
    if (!selectedHandle) {
      return;
    }

    if (!metadata?.metadata.dataCid) {
      return;
    }

    await ApiService.shareObject(metadata?.metadata.dataCid, selectedHandle);

    closeModal();
  }, [metadata, selectedHandle]);

  useEffect(() => {
    setSelectedHandle(null);
  }, [metadata]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={closeModal}>
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
                  Share "{metadata?.metadata.name}"
                </DialogTitle>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Enter the handle of the user you want to share with.
                  </p>
                </div>
                <HandleSelector
                  selectedHandle={selectedHandle}
                  setSelectedHandle={setSelectedHandle}
                />

                <div className="mt-4 flex justify-center">
                  <button
                    disabled={!selectedHandle}
                    type="button"
                    className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      selectedHandle
                        ? "bg-blue-100 text-blue-900 hover:bg-blue-200"
                        : "bg-gray-100 text-gray-900"
                    }`}
                    onClick={shareObject}
                  >
                    Share
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
