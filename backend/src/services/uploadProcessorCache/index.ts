import { MultiUploadBlockstore } from "./blockstore";

export const getUploadBlockstore = async (uploadId: string) => {
  return new MultiUploadBlockstore(uploadId);
};
