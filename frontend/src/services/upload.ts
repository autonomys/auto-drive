import {
  AuthProvider,
  createAutoDriveApi,
  uploadFileFromInput,
  uploadFolderFromInput,
} from '@autonomys/auto-drive';
import { getAuthSession } from '../utils/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const getApi = async () => {
  const session = await getAuthSession();
  if (!session?.accessToken || !session.authProvider) {
    throw new Error('No session found');
  }

  return createAutoDriveApi({
    url: API_BASE_URL,
    provider: session.authProvider as AuthProvider,
    apiKey: session.accessToken,
  });
};

const uploadFile = async (
  file: File,
  { password }: { password?: string } = {},
) => {
  const api = await getApi();

  return uploadFileFromInput(api, file, {
    password,
    compression: true,
  });
};

const uploadFolder = async (
  files: FileList,
  { password }: { password?: string } = {},
) => {
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
