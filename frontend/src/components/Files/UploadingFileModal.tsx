import { useCallback, useEffect, useState } from "react";
import { UploadService } from "../../services/upload";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
} from "@headlessui/react";
import { Button } from "../common/Button";

export const UploadingFileModal = ({
  file,
  onClose,
}: {
  file: File | null;
  onClose: () => void;
  password?: string;
  compress?: boolean;
}) => {
  const [progress, setProgress] = useState(0);
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();

  const manageUpload = useCallback(
    async (password: string | undefined) => {
      if (!file) return;

      const upload = UploadService.uploadFile(file, {
        password,
        compress: true,
      });
      for await (const chunkProgress of upload) {
        setProgress(chunkProgress);
      }
      onClose();
      setPasswordConfirmed(false);
    },
    [file, onClose]
  );

  const onConfirmPassword = useCallback(() => {
    if (passwordConfirmed) {
      const passwordToUse = password ?? undefined;
      console.log("uploading file with password: ", passwordToUse);
      manageUpload(passwordToUse).then(() => {
        window.location.reload();
      });
    }
  }, [passwordConfirmed, manageUpload, password]);

  useEffect(() => {
    if (passwordConfirmed) {
      onConfirmPassword();
    }
  }, [passwordConfirmed, onConfirmPassword]);

  const progressPercentage = Math.round(progress);

  return (
    <Transition show={!!file}>
      <Dialog as="div" onClose={onClose}>
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 shadow-lg transition-transform transform min-w-[25%]">
            {passwordConfirmed ? (
              <div>
                <DialogTitle>Uploading...</DialogTitle>
                <div className="mt-4">
                  <div
                    className="absolute top-0 left-0 h-2 bg-green-500 rounded transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className="flex flex-col gap-2 p-4">
                  <span className="block text-md font-semibold text-gray-700 text-center">
                    Enter Encrypting Password
                  </span>
                  <input
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    placeholder="Password"
                  />
                  <div className="flex gap-2 justify-center">
                    <Button
                      className="text-xs"
                      variant="lightAccent"
                      onClick={() => setPasswordConfirmed(true)}
                    >
                      {password
                        ? "Confirm Password"
                        : "Upload without encryption"}
                    </Button>
                    <Button
                      className="text-xs"
                      variant="lightDanger"
                      onClick={onClose}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
