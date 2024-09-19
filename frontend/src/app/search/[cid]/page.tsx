'use client'

import { useEffect, useState } from "react";
import { ApiService } from "../../../services/api";
import FileCard from "../../../components/common/FileCard";
import { UploadedObjectMetadata } from "../../../models/UploadedObjectMetadata";


export default function Page({ params: { cid } }: { params: { cid: string } }) {

    const [objectsMetadata, setObjectsMetadata] = useState<UploadedObjectMetadata[]>();

    useEffect(() => {
        ApiService.searchHeadCID(cid).then((e) => Promise.all(e.map(e => ApiService.fetchUploadedObjectMetadata(e)))).then(setObjectsMetadata);
    }, []);



    return (
        <div className="grid grid-cols-4 gap-4">
            {
                objectsMetadata ? objectsMetadata.length > 0 ? objectsMetadata.map(({ metadata, uploadStatus }) => {
                    switch (metadata.type) {
                        case "folder":
                            return <a key={metadata.dataCid} href={`/explorer/${metadata.dataCid}`} className="contents">
                                <FileCard metadata={metadata} uploadStatus={uploadStatus} />
                            </a>
                        case "file":
                            return <a key={metadata.dataCid} href={`/explorer/${metadata.dataCid}`} className="contents">
                                <FileCard metadata={metadata} uploadStatus={uploadStatus} />
                            </a>
                    }
                }) : <div className="text-center text-gray-500 flex flex-col items-center justify-center h-[50%] w-full text-xl">
                    No root objects, upload some!
                </div> : <></>
            }
        </div>
    );
}
