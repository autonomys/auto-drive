import {
  AuthProvider,
  createAutoDriveApi,
  uploadFileFromInput,
  UploadFileStatus,
  uploadFolderFromInput,
  UploadFolderStatus,
} from '@autonomys/auto-drive';
import { getAuthSession } from '../utils/auth';
import { cidToString } from '@autonomys/auto-dag-data';
import { PromisedObservable } from '@autonomys/auto-drive/dist/utils/observable';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const getApi = async () => {
  const session = await getAuthSession();
  if (!session?.accessToken || !session.provider) {
    throw new Error('No session found');
  }

  return createAutoDriveApi({
    url: API_BASE_URL,
    provider: session.provider as AuthProvider,
    apiKey: session.accessToken,
  });
};

const uploadFile = async (
  file: File,
  { password }: { password?: string } = {},
): Promise<PromisedObservable<UploadFileStatus>> => {
  const api = await getApi();

  return uploadFileFromInput(api, file, {
    password,
    compression: true,
  });
};

const uploadFolder = async (
  files: FileList,
  { password }: { password?: string } = {},
): Promise<PromisedObservable<UploadFileStatus | UploadFolderStatus>> => {
  const api = await getApi();

  const folderUploadObserver = await uploadFolderFromInput(api, files, {
    password,
  });

  return folderUploadObserver;
};

export const UploadService = {
  uploadFile,
  uploadFolder,
};
