import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";
import { ApiService } from "../../services/api";
import { HandleSelector } from "../HandleSearch";
import { Button } from "../common/Button";
import { Link } from "lucide-react";
import { Input } from "../common/Input";
import { isValidUUID } from "../../utils/misc";

export const ObjectShareModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const isOpen = cid !== null;
  const [publicId, setPublicId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<UploadedObjectMetadata | null>(null);

  useEffect(() => {
    if (cid) {
      ApiService.fetchUploadedObjectMetadata(cid).then(setMetadata);
    }
  }, [cid]);

  const shareObject = useCallback(async () => {
    if (!publicId) {
      return;
    }

    if (!metadata?.metadata.dataCid) {
      return;
    }

    await ApiService.shareObject(metadata?.metadata.dataCid, publicId)
      .then(async () => {
        toast.success("Object shared successfully");
        await new Promise((resolve) => setTimeout(resolve, 100));
        closeModal();
        window.location.reload();
      })
      .catch(() => {
        toast.error("Failed to share object");
      });
  }, [metadata, publicId]);

  useEffect(() => {
    setPublicId(null);
  }, [metadata]);

  const isAlreadyOwnwer = useMemo(() => {
    return !!metadata?.owners.some((owner) => owner.publicId === publicId);
  }, [metadata, publicId]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(
      `${window.location.origin}/drive/metadata/${metadata?.metadata.dataCid}`
    );
    toast.success("Link copied to clipboard");
  }, [metadata?.metadata.dataCid]);

  const invalidPublicId = useMemo(() => {
    return !isValidUUID(publicId);
  }, [publicId]);

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
                    Enter the public ID of the user you want to share with.
                  </p>
                </div>
                <input
                  className="border border-gray-300 rounded-md p-2 w-full"
                  value={publicId ?? ""}
                  onChange={(e) => setPublicId(e.target.value)}
                />
                <div className="mt-4 flex justify-center gap-2">
                  <Button
                    variant="lightAccent"
                    className="flex items-center gap-2"
                    onClick={copyLink}
                  >
                    <Link className="w-4 h-4" />
                    Share link
                  </Button>
                  <button
                    disabled={!publicId || isAlreadyOwnwer}
                    type="button"
                    className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      publicId && !isAlreadyOwnwer
                        ? "bg-blue-100 text-blue-900 hover:bg-blue-200"
                        : "bg-gray-100 text-gray-900 opacity-50"
                    }`}
                    onClick={shareObject}
                  >
                    Share with public ID
                  </button>
                </div>
                {isAlreadyOwnwer && (
                  <p className="text-sm text-red-500 text-center mt-4">
                    This user is already an owner of this object.
                  </p>
                )}
                {publicId && invalidPublicId && (
                  <p className="text-sm text-red-500 text-center mt-4">
                    Invalid public ID.
                  </p>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
