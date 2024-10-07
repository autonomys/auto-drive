import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";

export const Metadata = ({ object }: { object: UploadedObjectMetadata }) => {
  return (
    <div className="bg-white p-4 rounded-lg border-[#202124] border border-opacity-20 text-xs">
      <div className="flex flex-col mb-4">
        <h4 className="font-medium text-sm text-black">
          {object.metadata.name}
        </h4>
        <p className="text-gray-500">Size: {object.metadata.totalSize}</p>
        <p>
          CID: <span className="text-blue-500">{object.metadata.dataCid}</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-black font-light">
        <div className="flex">
          <span>Type:</span>
          <span className="ml-[4px]">
            {object.metadata.type === "folder"
              ? "Folder"
              : object.metadata.mimeType || "File"}
          </span>
        </div>
        <div className="flex">
          <span>{"Owner: "}</span>
          <span className="ml-[4px]">You</span>
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
    </div>
  );
};
