import { useCallback, useState } from "react";
import { ApiKeyCreationModal } from "./ApiKeyCreationModal";
import { ApiKeyWithoutSecret } from "../../models/ApiKey";
import { DeleteApiKeyModal } from "./DeleteApiKeyModal";
import { Loader } from "lucide-react";
import { Table } from "../common/Table";
import {
  TableHead,
  TableHeadCell,
  TableHeadRow,
} from "../common/Table/TableHead";
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from "../common/Table/TableBody";

export const ApiKeysTable = ({
  apiKeys,
}: {
  apiKeys: ApiKeyWithoutSecret[] | undefined;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiKeyId, setApiKeyId] = useState<string | null>(null);

  const closeCreationModal = useCallback(() => setIsOpen(false), []);
  const openCreationModal = useCallback(() => setIsOpen(true), []);

  const openDeleteModal = useCallback((apiKeyId: string) => {
    setApiKeyId(apiKeyId);
  }, []);
  const closeDeleteModal = useCallback(() => setApiKeyId(null), []);

  const nonDeletedApiKeys = apiKeys?.filter((apiKey) => !apiKey.deletedAt);

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
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>ID</TableHeadCell>
                <TableHeadCell>OAuth Provider</TableHeadCell>
                <TableHeadCell>OAuth User ID</TableHeadCell>
                <TableHeadCell>Actions</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {nonDeletedApiKeys &&
                nonDeletedApiKeys.map((apiKey) => (
                  <TableBodyRow key={apiKey.id}>
                    <TableBodyCell>{apiKey.id}</TableBodyCell>
                    <TableBodyCell>{apiKey.oauthProvider}</TableBodyCell>
                    <TableBodyCell>{apiKey.oauthUserId}</TableBodyCell>
                    <TableBodyCell>
                      <button
                        className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
                        onClick={() => openDeleteModal(apiKey.id)}
                      >
                        Delete
                      </button>
                    </TableBodyCell>
                  </TableBodyRow>
                ))}
              {nonDeletedApiKeys && nonDeletedApiKeys.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={4}
                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center"
                  >
                    No API keys found
                  </TableBodyCell>
                </TableBodyRow>
              )}
              {!nonDeletedApiKeys && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={4}
                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center"
                  >
                    <span className="flex justify-center items-center">
                      <Loader className="w-4 h-4 animate-spin" />
                    </span>
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};
