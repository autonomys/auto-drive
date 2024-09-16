'use client'

import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect, useState } from "react";
import { ApiService } from "../services/api";
import FileCard from "../components/common/FileCard";
import { OffchainMetadata } from "@autonomys/auto-drive";


export default function Page() {
  const [localObjectCIDs,] = useLocalStorage<string[]>("root-objects-cid", []);

  const [rootObjectMetadata, setRootObjectMetadata] = useState<OffchainMetadata[]>();


  useEffect(() => {
    Promise.all(localObjectCIDs.map(e => ApiService.fetchMetadata(e))).then(setRootObjectMetadata);
  }, []);



  return (
    <div className="flex h-screen flex">
      {
        rootObjectMetadata ? rootObjectMetadata.length > 0 ? rootObjectMetadata.map((metadata) => {
          switch (metadata.type) {
            case "folder":
              return <a key={metadata.dataCid} href={`/fs/${metadata.dataCid}`} className="contents">
                <FileCard cid={metadata.dataCid} name={metadata.dataCid ?? ""} type={metadata.type} size={metadata.totalSize} />
              </a>
            case "file":
              return <FileCard cid={metadata.dataCid} name={metadata.name ?? ""} type={metadata.type} size={metadata.totalSize} />
          }
        }) : <div className="text-center text-gray-500 flex flex-col items-center justify-center h-[50%] w-full text-xl">
          No root objects, upload some!
        </div> : <></>
      }
    </div>
  );
}
