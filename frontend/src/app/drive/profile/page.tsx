"use client";

import { useEffect, useState, useCallback } from "react";
import { ApiService } from "../../../services/api";
import { ApiKeyWithoutSecret } from "../../../models/ApiKey";
import { ApiKeysTable } from "../../../components/ApiKeysTable";
import { Button } from "../../../components/common/Button";
import { DefaultPasswordModal } from "../../../components/DefaultPasswordModal";

export default function Page() {
  const [apiKeys, setApiKeys] = useState<ApiKeyWithoutSecret[]>();
  const [isDefaultPasswordModalOpen, setIsDefaultPasswordModalOpen] =
    useState<boolean>(false);

  useEffect(() => {
    ApiService.getApiKeysByUser().then(setApiKeys);
  }, []);

  const openDefaultPasswordModal = useCallback(() => {
    setIsDefaultPasswordModalOpen(true);
  }, []);

  const closeDefaultPasswordModal = useCallback(() => {
    setIsDefaultPasswordModalOpen(false);
  }, []);

  return (
    <div>
      <DefaultPasswordModal
        isOpen={isDefaultPasswordModalOpen}
        onClose={closeDefaultPasswordModal}
      />
      <span className="text-2xl font-bold mb-4">API Keys</span>
      <div className="flex flex-col gap-2 p-2">
        <ApiKeysTable apiKeys={apiKeys} />
      </div>
      <div className="flex flex-col gap-2 p-2">
        <span className="text-2xl font-bold mb-4">Encryption</span>
        <div className="flex gap-2">
          <span>
            <Button
              variant="lightAccent"
              className="text-sm"
              onClick={openDefaultPasswordModal}
            >
              Update default password
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
