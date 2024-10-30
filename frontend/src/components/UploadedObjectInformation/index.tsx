import {
  OwnerRole,
  UploadedObjectMetadata,
} from "../../models/UploadedObjectMetadata";
import { getTypeFromMetadata, handleFileDownload } from "../../utils/file";
import { useUserStore } from "../../states/user";
import { useCallback, useMemo, useState } from "react";
import { Button } from "../common/Button";
import { ApiService } from "../../services/api";
import { ObjectShareModal } from "../Files/ObjectShareModal";
import { ObjectDeleteModal } from "../Files/ObjectDeleteModal";
import { Loader } from "lucide-react";
import { ObjectDownloadModal } from "../Files/ObjectDownloadModal";

export const UploadedObjectInformation = ({
  object,
}: {
  object: UploadedObjectMetadata | null;
}) => {
  const [downloadModalCid, setDownloadModalCid] = useState<string | null>(null);
  const [shareModalCid, setShareModalCid] = useState<string | null>(null);
  const [deleteModalCid, setDeleteModalCid] = useState<string | null>(null);
  const user = useUserStore(({ user }) => user);
  const ownerHandle = object?.owners.find(
    (o) => o.role === OwnerRole.ADMIN
  )?.handle;

  const owners = useMemo(() => {
    return object?.owners.sort((a, b) => a.role.localeCompare(b.role));
  }, [object?.owners]);

  const isOwner = owners?.some(
    (o) => o.handle === user?.handle && o.role === OwnerRole.ADMIN
  );
  const hasFileOwnership = object?.owners.some(
    (o) => o.handle === user?.handle
  );

  const handleDownload = useCallback(async () => {
    if (!object) {
      return;
    }
    setDownloadModalCid(object.metadata.dataCid);
  }, [object?.metadata.dataCid]);

  const handleShare = useCallback(() => {
    setShareModalCid(object?.metadata.dataCid ?? null);
  }, [object?.metadata.dataCid]);

  const handleDelete = useCallback(() => {
    setDeleteModalCid(object?.metadata.dataCid ?? null);
  }, [object?.metadata.dataCid]);

  const isLoading = object === null;
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex justify-center items-center">
          <Loader className="w-4 h-4 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ObjectDownloadModal
        cid={downloadModalCid}
        onClose={() => setDownloadModalCid(null)}
      />
      <ObjectShareModal
        cid={shareModalCid}
        closeModal={() => setShareModalCid(null)}
      />
      <ObjectDeleteModal
        cid={deleteModalCid}
        closeModal={() => setDeleteModalCid(null)}
      />
      <div className="flex gap-4">
        <Button
          variant="lightAccent"
          className="text-sm"
          onClick={handleDownload}
        >
          Download
        </Button>
        <Button
          variant="lightAccent"
          className="disabled:hidden text-sm"
          onClick={handleShare}
          disabled={!isOwner}
        >
          Share
        </Button>
        <Button
          variant="danger"
          className="disabled:hidden text-sm"
          onClick={handleDelete}
          disabled={!hasFileOwnership}
        >
          Delete
        </Button>
      </div>
      <span className="text-xl font-semibold ml-2">Metadata</span>
      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-primary font-medium bg-gray-50 p-4 rounded-lg">
        <div className="flex">
          <span>Name:</span>
          <span className="ml-[4px]">{object.metadata.name ?? "Unnamed"}</span>
        </div>
        <div className="flex">
          <span>Type:</span>
          <span className="ml-[4px]">
            {getTypeFromMetadata(object.metadata)}
          </span>
        </div>
        <div className="flex">
          <span>{"Owner: "}</span>
          <span className="ml-[4px]">
            {ownerHandle === user?.handle ? "You" : ownerHandle}
          </span>
        </div>
        <div className="flex">
          <span>Total Nodes: </span>
          <span className="ml-[4px]">
            {object.uploadStatus.totalNodes ?? "Processing"}
          </span>
        </div>
        <div className="flex">
          <span>Uploaded Nodes: </span>
          <span className="ml-[4px]">
            {object.uploadStatus.uploadedNodes ?? "N/A"}
          </span>
        </div>
        <div className="flex">
          <span>Minimum block depth:</span>
          <span className="ml-[4px]">
            {object.uploadStatus.minimumBlockDepth ?? "N/A"}
          </span>
        </div>
        <div className="flex">
          <span>Maximum block depth:</span>
          <span className="ml-[4px]">
            {object.uploadStatus.maximumBlockDepth ?? "N/A"}
          </span>
        </div>
        <div className="flex">
          <span>Archive blocks count:</span>
          <span className="ml-[4px]">0</span>
        </div>
      </div>
      <span className="text-xl font-semibold ml-2">Upload Status</span>
      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-primary font-medium bg-gray-50 p-4 rounded-lg">
        <div className="flex">
          <span>Total Nodes: </span>
          <span className="ml-[4px]">{object.uploadStatus.totalNodes}</span>
        </div>
        <div className="flex">
          <span>Uploaded Nodes: </span>
          <span className="ml-[4px]">{object.uploadStatus.uploadedNodes}</span>
        </div>
        <div className="flex">
          <span>Minimum block depth:</span>
          <span className="ml-[4px]">
            {object.uploadStatus.minimumBlockDepth ?? "N/A"}
          </span>
        </div>
        <div className="flex">
          <span>Maximum block depth:</span>
          <span className="ml-[4px]">
            {object.uploadStatus.maximumBlockDepth ?? "N/A"}
          </span>
        </div>
        <div className="flex">
          <span>Archive blocks count:</span>
          <span className="ml-[4px]">0</span>
        </div>
      </div>
      <span className="text-xl font-semibold ml-2">Owners</span>
      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-primary font-medium bg-gray-50 p-4 rounded-lg">
        {owners?.map((o) => (
          <div className="flex">
            <span>{o.role.charAt(0).toUpperCase() + o.role.slice(1)}</span>
            <span className="ml-[4px]">{o.handle}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
