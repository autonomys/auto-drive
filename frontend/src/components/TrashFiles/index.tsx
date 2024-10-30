import { LoaderCircle } from "lucide-react";
import {
  ObjectSummary,
  UploadedObjectMetadata,
} from "../../models/UploadedObjectMetadata";
import { FileDropZone } from "../Files/FileDropZone";
import { UploadingObjects } from "../Files/UploadingObjects";
import { NoFilesInTrashPlaceholder } from "./NoFilesInTrashPlaceholder";
import { DeletedFilesTable } from "../common/DeleteFilesTable";

export const TrashFiles = ({
  objects,
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  totalItems,
}: {
  objects: ObjectSummary[] | null;
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  currentPage: number;
  setCurrentPage: (currentPage: number) => void;
  totalItems: number;
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
          {objects && objects.length > 0 && (
            <DeletedFilesTable
              files={objects}
              pageSize={pageSize}
              setPageSize={setPageSize}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              totalItems={totalItems}
            />
          )}
          {objects && objects.length === 0 && <NoFilesInTrashPlaceholder />}
        </div>
      </div>
    </div>
  );
};
