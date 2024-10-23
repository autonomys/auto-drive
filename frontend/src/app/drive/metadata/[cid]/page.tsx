"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../../../../services/api";
import { UploadedObjectMetadata } from "../../../../models/UploadedObjectMetadata";
import { Metadata } from "../../../../components/Files/Metadata";
import { UploadedObjectInformation } from "../../../../components/UploadedObjectInformation";

export default function Page({ params }: { params: { cid: string } }) {
  const [metadata, setMetadata] = useState<UploadedObjectMetadata | null>(null);

  useEffect(() => {
    ApiService.fetchUploadedObjectMetadata(params.cid).then(setMetadata);
  }, [params.cid]);

  return metadata && <UploadedObjectInformation object={metadata} />;
}
