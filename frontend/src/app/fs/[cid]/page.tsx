import FileCard from "../../../components/common/FileCard";
import { ApiService } from "../../../services/api";

export default async function Page({ params }: { params: { cid: string } }) {
  const { cid } = params;

  const objMetadata = await ApiService.fetchUploadedObjectMetadata(cid);

  if (objMetadata.metadata.type === "file") {
    throw new Error("File type not supported");
  }

  const childrenMetadata = await Promise.all(
    objMetadata.metadata.children.map((e) =>
      ApiService.fetchUploadedObjectMetadata(e.cid),
    ),
  );

  return (
    <div className="grid grid-cols-4 gap-4">
      {childrenMetadata.map(({ metadata }) => {
        return <FileCard key={metadata.dataCid} metadata={metadata} />;
      })}
    </div>
  );
}
