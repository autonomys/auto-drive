"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../../../services/api";
import { ApiKeyWithoutSecret } from "../../../models/ApiKey";
import { ApiKeysTable } from "../../../components/ApiKeysTable";

export default function Page() {
  const [apiKeys, setApiKeys] = useState<ApiKeyWithoutSecret[]>();

  useEffect(() => {
    ApiService.getApiKeysByUser().then(setApiKeys);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">API Keys</h1>
      <div className="flex flex-col gap-2 p-2">
        <ApiKeysTable apiKeys={apiKeys} />
      </div>
    </div>
  );
}
