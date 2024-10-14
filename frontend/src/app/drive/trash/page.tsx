"use client";

import { ApiService } from "@/services/api";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { UploadedObjectMetadata } from "../../../models/UploadedObjectMetadata";
import { TrashFiles } from "../../../components/TrashFiles";

export default function Page() {
  const [rootObjectMetadata, setRootObjectMetadata] = useState<
    UploadedObjectMetadata[] | null
  >(null);

  useEffect(() => {
    setRootObjectMetadata(null);
    ApiService.getTrashObjects().then((e) => {
      const promises = e.map((e) => ApiService.fetchUploadedObjectMetadata(e));
      Promise.all(promises).then(setRootObjectMetadata);
    });
  }, []);

  return <TrashFiles objects={rootObjectMetadata} />;
}
