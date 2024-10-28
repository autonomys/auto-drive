import { MultiUploadBlockstore } from "./blockstore.js";

export const getUploadBlockstore = async (uploadId: string) => {
  return new MultiUploadBlockstore(uploadId);
};
