import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { Fragment, useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "../common/Button";
import { useEncryptionStore } from "../../states/encryption";

export const DefaultPasswordModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const setDefaultPassword = useEncryptionStore((store) => store.setPassword);
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");

  useEffect(() => {
    setNewPassword("");
    setConfirmPassword("");
  }, [isOpen]);

  const updatePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    try {
      toast.success("Password updated successfully");
      onClose();
      setDefaultPassword(newPassword);
    } catch (error) {
      toast.error("Failed to update password");
    }
  }, [newPassword, confirmPassword]);

  const isDisabled =
    !newPassword || !confirmPassword || newPassword !== confirmPassword;

  return (
    <Transition appear show={isOpen} as={Fragment}>
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
                  Update Default Password
                </DialogTitle>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Enter your new password.
                  </p>
                </div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New Password"
                  className="mt-2 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm Password"
                  className="mt-2 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                />
                <div className="mt-4 flex justify-center gap-2">
                  <Button
                    disabled={isDisabled}
                    variant="primary"
                    className="text-xs"
                    onClick={updatePassword}
                  >
                    Update Password
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
