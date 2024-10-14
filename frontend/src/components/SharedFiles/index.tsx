import { LoaderCircle } from "lucide-react";
import { UploadedObjectMetadata } from "../../models/UploadedObjectMetadata";
import { FileDropZone } from "../Files/FileDropZone";
import { FileTable } from "../common/FileTable";
import { UploadingObjects } from "../Files/UploadingObjects";
import { NoSharedFilesPlaceholder } from "./NoSharedFilesPlaceholder";

export const SharedFiles = ({
  objects,
}: {
  objects: UploadedObjectMetadata[] | null;
}) => {
  return (
    <div className="flex w-full">
      <div className="w-full flex flex-col gap-4">
        <FileDropZone />
        <div className="">
          <UploadingObjects />
          {objects === null && (
            <div className="flex min-h-[50vh] justify-center items-center">
              <LoaderCircle className="w-10 h-10 animate-spin" />
            </div>
          )}
          {objects && objects.length > 0 && <FileTable files={objects} />}
          {objects && objects.length === 0 && <NoSharedFilesPlaceholder />}
        </div>
      </div>
    </div>
  );
};
