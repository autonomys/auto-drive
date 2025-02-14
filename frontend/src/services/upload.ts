import { AuthProvider, createAutoDriveApi } from '@autonomys/auto-drive';
import { getAuthSession } from '../utils/auth';

export type UploadService = ReturnType<typeof createUploadService>;

export const createUploadService = (apiBaseUrl: string) => {
  const getApi = async () => {
    const session = await getAuthSession();
    if (!session?.accessToken || !session.authProvider) {
      throw new Error('No session found');
    }

    return createAutoDriveApi({
      url: apiBaseUrl,
      provider: session.authProvider as AuthProvider,
      apiKey: session.accessToken,
    });
  };

  const uploadFile = async (
    file: File,
    {
      password,
      onProgress,
    }: { password?: string; onProgress?: (progress: number) => void } = {},
  ) => {
    const api = await getApi();

    return api.uploadFileFromInput(file, {
      password,
      compression: true,
      onProgress,
    });
  };

  const uploadFolder = async (
    files: FileList,
    {
      password,
      onProgress,
    }: { password?: string; onProgress?: (progress: number) => void } = {},
  ) => {
    const api = await getApi();

    const folderUploadObserver = await api.uploadFolderFromInput(files, {
      password,
      onProgress,
    });

    return folderUploadObserver;
  };

  return {
    uploadFile,
    uploadFolder,
  };
};
