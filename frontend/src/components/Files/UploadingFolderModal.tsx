import { useCallback, useEffect, useState } from "react";
import { UploadService } from "../../services/upload";
import { Dialog, Transition } from "@headlessui/react";
import { FolderTree } from "../../models/FileTree";
import { OffchainMetadata } from "@autonomys/auto-drive";
import { Button } from "../common/Button";
import { shortenString } from "../../utils/misc";
import { FileWarning } from "lucide-react";
import { useEncryptionStore } from "../../states/encryption";

export const UploadingFolderModal = ({
  data,
  onClose,
}: {
  data: { files: Record<string, File>; fileTree: FolderTree } | null;
  onClose: () => void;
}) => {
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>();
  const [progress, setProgress] = useState(0);

  const progressPercentage = Math.round(progress);

  const handleUpload = useCallback(async () => {
    if (!data) return;

    const passwordToUse = password ? password : undefined;

    if (passwordToUse) {
      const progressIterable = UploadService.createEncryptedFolderUpload(
        data.fileTree,
        data.files,
        passwordToUse
      );
      for await (const progress of progressIterable) {
        setProgress(progress);
      }
    } else {
      const progressIterable = UploadService.uploadFolder(
        data.fileTree,
        data.files,
        {
          compress: true,
        }
      );
      for await (const progress of progressIterable) {
        setProgress(progress);
      }
    }

    setPasswordConfirmed(false);
    onClose();
  }, [data, password]);

  useEffect(() => {
    if (!passwordConfirmed) return;

    handleUpload();
  }, [passwordConfirmed]);

  const defaultPassword = useEncryptionStore((store) => store.password);

  const setDefaultPassword = useCallback(() => {
    setPassword(defaultPassword);
    setPasswordConfirmed(true);
  }, [defaultPassword]);

  return (
    <Transition show={!!data}>
      <Dialog as="div" onClose={onClose}>
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 shadow-lg transition-transform transform min-w-[25%]">
            <h3 className="text-lg font-medium mb-4 text-center">
              Uploading{" "}
              <strong>{shortenString(data?.fileTree.name ?? "", 20)}</strong>
            </h3>
            {passwordConfirmed ? (
              <div>
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
                      disabled={!defaultPassword}
                      className="text-xs"
                      variant="lightAccent"
                      onClick={setDefaultPassword}
                    >
                      Encrypt with default password
                    </Button>
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
                  <div className="flex items-center gap-2 bg-yellow-50 p-2 rounded overflow-hidden mt-4">
                    <FileWarning className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm text-gray-500 font-semibold">
                      Encrypted folders will be uploaded as encrypted zip files.
                    </span>
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
