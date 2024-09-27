import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";
import { FileCard } from "../common/FileCard";

export const FilesView = ({
  dirChildren,
}: {
  dirChildren: UploadedObjectMetadata[];
}) => {
  return (
    <div className="grid grid-cols-3 gap-4">
      {dirChildren.length > 0 ? (
        dirChildren.map(({ metadata, uploadStatus }) => {
          switch (metadata.type) {
            case "folder":
              return (
                <a
                  key={metadata.dataCid}
                  href={`/app/fs/${metadata.dataCid}`}
                  className="contents"
                >
                  <FileCard uploadStatus={uploadStatus} metadata={metadata} />
                </a>
              );
            case "file":
              return (
                <FileCard uploadStatus={uploadStatus} metadata={metadata} />
              );
          }
        })
      ) : (
        <div className="text-center text-gray-500 flex flex-col items-center justify-center h-[50%] w-full text-xl">
          No root objects, upload some!
        </div>
      )}
    </div>
  );
};
