import { useCallback, useState } from "react";
import { ApiKeyCreationModal } from "./ApiKeyCreationModal";
import { ApiKeyWithoutSecret } from "../../models/ApiKey";
import { DeleteApiKeyModal } from "./DeleteApiKeyModal";

export const ApiKeysTable = ({
  apiKeys,
}: {
  apiKeys: ApiKeyWithoutSecret[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiKeyId, setApiKeyId] = useState<string | null>(null);

  const closeCreationModal = useCallback(() => setIsOpen(false), []);
  const openCreationModal = useCallback(() => setIsOpen(true), []);

  const openDeleteModal = useCallback((apiKeyId: string) => {
    setApiKeyId(apiKeyId);
  }, []);
  const closeDeleteModal = useCallback(() => setApiKeyId(null), []);

  const nonDeletedApiKeys = apiKeys.filter((apiKey) => !apiKey.deletedAt);

  return (
    <div className="flex flex-col">
      <ApiKeyCreationModal isOpen={isOpen} onClose={closeCreationModal} />
      <DeleteApiKeyModal apiKeyId={apiKeyId} closeModal={closeDeleteModal} />
      <div className="">
        <button
          className="text-white bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded mr-2 mb-4"
          onClick={openCreationModal}
        >
          Create API Key
        </button>
      </div>
      <div className="mb-8">
        <div className="shadow border-b border-gray-200 sm:rounded-lg min-w-[fit-content] w-full">
          <table className="min-w-full">
            <thead className="bg-gray-50 ">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  OAuth Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  OAuth User ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="w-full">
              {nonDeletedApiKeys.map((apiKey) => (
                <tr className="w-full" key={apiKey.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {apiKey.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {apiKey.oauthProvider}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {apiKey.oauthUserId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
                      onClick={() => openDeleteModal(apiKey.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
