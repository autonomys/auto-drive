import { useEffect, useMemo, useState } from 'react';
import { OffchainMetadata } from '@autonomys/auto-dag-data';
import { simpleMimeType } from '../../utils/misc';
import { useNetwork } from '../../contexts/network';
import { Arguments } from '../common/Arguments';
import { FolderPreview } from './FolderPreview';
import { NoPreviewAvailable } from './NoPreviewAvailable';

const MAX_FILE_SIZE = BigInt(100 * 1024 * 1024); // 100 MB

export const FilePreview = ({ metadata }: { metadata: OffchainMetadata }) => {
  const network = useNetwork();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFilePreviewable, setIsFilePreviewable] = useState(false);
  const [file, setFile] = useState<Blob | null>(null);

  useEffect(() => {
    const fetchFile = async () => {
      if (
        metadata.uploadOptions?.encryption ||
        metadata.totalSize > MAX_FILE_SIZE
      ) {
        setIsFilePreviewable(false);
      } else {
        setIsFilePreviewable(true);
      }
    };
    fetchFile();
  }, [metadata]);

  useEffect(() => {
    if (isFilePreviewable) {
      setLoading(true);
      network.api
        .downloadObject(metadata.dataCid)
        .then(async (file) => {
          let buffer = Buffer.alloc(0);
          for await (const chunk of file) {
            buffer = Buffer.concat([buffer, chunk]);
          }
          const blob = new Blob([buffer], {
            type:
              metadata.type === 'file' && metadata.mimeType
                ? simpleMimeType(metadata.mimeType)
                : undefined,
          });
          setFile(blob);
          setLoading(false);
        })
        .catch((error) => {
          setError(error.message);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [metadata, isFilePreviewable, network.api]);

  const fileData = useMemo(() => {
    return (
      file && {
        uri: URL.createObjectURL(file),
        fileName: metadata.name,
        fileType: metadata.type === 'file' ? metadata.mimeType : undefined,
      }
    );
  }, [file, metadata]);

  const preview = useMemo(() => {
    if (loading) {
      return <div>Loading...</div>;
    }

    if (error) {
      return <div>Error: {error}</div>;
    }

    if (metadata.type === 'folder') {
      return <FolderPreview metadata={metadata} />;
    }

    if (!isFilePreviewable || !fileData) {
      return <NoPreviewAvailable />;
    }

    if (
      metadata.type === 'file' &&
      metadata.mimeType === 'application/json' &&
      file
    ) {
      return <Arguments file={file} />;
    }

    return (
      <object
        className='h-[50vh] w-full'
        data={fileData?.uri}
        type={fileData?.fileType}
        aria-label={fileData?.fileName}
        title={fileData?.fileName}
      />
    );
  }, [loading, error, metadata, file, isFilePreviewable, fileData]);

  return preview;
};
