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
import { Button } from "../common/Button";

export const ObjectRestoreModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const onRestoreObject = useCallback(() => {
    if (!cid) {
      return;
    }

    ApiService.restoreObject(cid).then(() => {
      toast.success("Object restored successfully");
      closeModal();
      window.location.reload();
    });
  }, [cid, closeModal]);

  return (
    <Transition appear show={cid !== null} as={Fragment}>
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
          <div className="fixed inset-0 bg-black bg-opacity-25" />
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
                  className="text-lg font-medium leading-6 text-gray-900 text-center"
                >
                  Restore File
                </DialogTitle>
                <div className="mt-2">
                  <p className="text-sm text-gray-500 text-center">
                    Are you sure you want to restore this file?
                  </p>
                </div>

                <div className="mt-4 flex justify-center space-x-2">
                  <Button
                    variant="lightAccent"
                    className="text-sm"
                    onClick={onRestoreObject}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="lightDanger"
                    className="text-sm"
                    onClick={closeModal}
                  >
                    Cancel
                  </Button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
