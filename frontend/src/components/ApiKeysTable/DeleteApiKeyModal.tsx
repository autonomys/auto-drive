import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { Fragment, useCallback } from "react";
import { ApiService } from "../../services/api";
import toast from "react-hot-toast";

export const DeleteApiKeyModal = ({
  apiKeyId,
  closeModal,
}: {
  apiKeyId: string | null;
  closeModal: () => void;
}) => {
  const isOpen = apiKeyId !== null;

  const deleteApiKey = useCallback(() => {
    if (!apiKeyId) {
      return;
    }

    ApiService.deleteApiKey(apiKeyId)
      .then(() => {
        toast.success("API key deleted successfully");
        closeModal();
        window.location.reload();
      })
      .catch(() => {
        toast.error("Failed to delete API key");
      });
  }, [apiKeyId, closeModal]);

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
                  Delete API Key
                </DialogTitle>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Do you want to delete this API key?
                  </p>
                </div>
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
                    onClick={deleteApiKey}
                  >
                    Delete
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
