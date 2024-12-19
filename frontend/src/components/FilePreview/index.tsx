import { useEffect, useMemo, useState } from 'react';
import { ApiService } from '../../services/api';
import { OffchainMetadata } from '@autonomys/auto-dag-data';
import DocViewer, { DocViewerRenderers } from '@cyntler/react-doc-viewer';
import '@cyntler/react-doc-viewer/dist/index.css';
import { simpleMimeType } from '../../utils/misc';

const MAX_FILE_SIZE = BigInt(100 * 1024 * 1024); // 100 MB

export const FilePreview = ({ metadata }: { metadata: OffchainMetadata }) => {
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
      ApiService.downloadObject(metadata.dataCid)
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
  }, [metadata, isFilePreviewable]);

  const documents = useMemo(() => {
    return (
      file && [
        {
          uri: URL.createObjectURL(file),
          fileName: metadata.name,
          fileType: metadata.type === 'file' ? metadata.mimeType : undefined,
        },
      ]
    );
  }, [file, metadata]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  const noRenderer = () => (
    <div className='flex h-full items-center justify-center'>
      <div className='text-center text-gray-500'>File is not previewable</div>
    </div>
  );

  if (!isFilePreviewable) {
    return noRenderer();
  }

  return (
    <DocViewer
      documents={documents ?? []}
      pluginRenderers={DocViewerRenderers}
      initialActiveDocument={documents?.[0]}
      config={{
        noRenderer: {
          overrideComponent: noRenderer,
        },
        header: {
          disableHeader: true,
        },
      }}
    />
  );
};
