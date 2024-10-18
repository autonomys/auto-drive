"use client";

import {
  Transition,
  Dialog,
  TransitionChild,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { Fragment, useCallback, useState } from "react";
import { ApiService } from "../../services/api";
import toast from "react-hot-toast";
import { UserRole } from "../../models/User";

export const UpdateRoleModal = ({
  userHandle,
  onClose,
}: {
  userHandle: string | null;
  onClose: () => void;
}) => {
  const [role, setRole] = useState<UserRole>(UserRole.User);

  const updateRole = useCallback(async () => {
    if (userHandle) {
      if (role === UserRole.Admin) {
        await ApiService.addAdmin(userHandle);
      } else {
        await ApiService.removeAdmin(userHandle);
      }
      onClose();
      toast.success("Role updated");
    }
  }, [userHandle, role]);

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
                  Update user role
                </DialogTitle>
                <div className="mt-2">
                  <div className="space-y-4">
                    <div>
                      <select
                        className="border border-gray-300 rounded px-2 py-1 w-full"
                        value={role}
                        onChange={(e) => setRole(e.target.value as UserRole)}
                      >
                        <option value={UserRole.User}>
                          User (Manage own files)
                        </option>
                        <option value={UserRole.Admin}>
                          Admin (Manage user's subscriptions)
                        </option>
                      </select>
                    </div>
                    <div className="flex justify-end">
                      <button
                        className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
                        onClick={updateRole}
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
