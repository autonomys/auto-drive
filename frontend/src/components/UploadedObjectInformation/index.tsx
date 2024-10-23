import { ArrowLeft, Loader } from "lucide-react";
import {
  OwnerRole,
  UploadedObjectMetadata,
} from "../../models/UploadedObjectMetadata";
import { getTypeFromMetadata } from "../../utils/file";
import { useUserStore } from "../../states/user";
import { useMemo } from "react";

export const UploadedObjectInformation = ({
  object,
}: {
  object: UploadedObjectMetadata | null;
}) => {
  if (!object) {
    return <Loader className="animate-spin" />;
  }

  const { user } = useUserStore();
  const ownerHandle = object.owners.find(
    (o) => o.role === OwnerRole.ADMIN
  )?.handle;

  const owners = useMemo(() => {
    return object.owners.sort((a, b) => a.role.localeCompare(b.role));
  }, [object.owners]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center ml-2">
        <button
          className="bg-accent p-1 rounded-full text-white hover:bg-accent/80 hover:scale-105 transition-all"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
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
        {owners.map((o) => (
          <div className="flex">
            <span>{o.role.charAt(0).toUpperCase() + o.role.slice(1)}</span>
            <span className="ml-[4px]">{o.handle}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
