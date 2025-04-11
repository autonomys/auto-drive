import { useEffect, useMemo, useState } from 'react';
import { OffchainMetadata } from '@autonomys/auto-dag-data';
import { Arguments } from 'components/common/Arguments';
import { FolderPreview } from '../FolderPreview';
import { NoPreviewAvailable } from './NoPreviewAvailable';
import {
  DocumentTextIcon,
  CodeBracketIcon,
  DocumentIcon,
  MusicalNoteIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { EXTERNAL_ROUTES } from '@/constants/routes';

const MAX_FILE_SIZE = BigInt(100 * 1024 * 1024); // 100 MB

const ImageViewer = ({ src, alt }: { src: string; alt?: string }) => {
  return (
    <div className='relative flex flex-col items-center'>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || 'Image preview'}
        className={cn(
          'max-h-[50vh] w-auto object-contain dark:border dark:border-gray-700 dark:bg-gray-900',
        )}
      />
    </div>
  );
};

const VideoPlayer = ({ src, type }: { src: string; type?: string }) => {
  return (
    <div className='flex justify-center'>
      <video
        className='max-h-[50vh] max-w-full dark:border dark:border-gray-700'
        controls
        autoPlay={false}
      >
        <source src={src} type={type} />
        <track kind='captions' src='' label='English' />
        Your browser does not support the video tag.
      </video>
    </div>
  );
};

const AudioPlayer = ({ src }: { src: string }) => {
  return (
    <div className='flex flex-col items-center justify-center rounded-lg bg-gray-100 p-6 dark:bg-gray-800'>
      <MusicalNoteIcon className='mb-4 h-16 w-16 text-gray-400 dark:text-gray-500' />
      <audio className='w-full' controls>
        <source src={src} />
        <track kind='captions' src='' label='English' />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
};

const JSONViewer = ({ content }: { content: string }) => {
  try {
    const jsonData = JSON.parse(content);
    return (
      <div className='relative overflow-hidden rounded-md'>
        <div className='absolute right-2 top-2 z-10'>
          <CodeBracketIcon className='h-5 w-5 text-gray-500 dark:text-gray-400' />
        </div>
        <pre className='max-h-[50vh] overflow-auto bg-gray-800 p-4 text-gray-100 dark:bg-gray-900'>
          <code>
            {'{\n'}
            {Object.entries(jsonData).map(([key, value]) => (
              <div key={key} className='ml-4'>
                <span className='text-blue-300 dark:text-blue-400'>
                  &quot;{key}&quot;
                </span>
                :
                <span className='text-green-300 dark:text-green-400'>
                  {typeof value === 'object'
                    ? ' ' + JSON.stringify(value, null, 2)
                    : ' ' + JSON.stringify(value)}
                </span>
                {',\n'}
              </div>
            ))}
            {'}'}
          </code>
        </pre>
      </div>
    );
  } catch (err) {
    console.error('Failed to parse JSON:', err);
    return <TextViewer content={content} extension='json' />;
  }
};

const TextViewer = ({
  content,
  extension,
}: {
  content: string;
  extension: string;
}) => {
  const isCode = [
    'js',
    'jsx',
    'ts',
    'tsx',
    'html',
    'css',
    'py',
    'java',
    'rb',
    'go',
    'rust',
    'php',
    'json',
  ].includes(extension);

  return (
    <div className='relative overflow-hidden rounded-md'>
      <div className='absolute right-2 top-2 z-10'>
        {isCode ? (
          <CodeBracketIcon className='h-5 w-5 text-gray-500 dark:text-gray-400' />
        ) : (
          <DocumentTextIcon className='h-5 w-5 text-gray-500 dark:text-gray-400' />
        )}
      </div>
      <pre
        className={cn(
          'max-h-[50vh] overflow-auto p-4',
          isCode
            ? 'bg-gray-800 text-gray-100 dark:bg-gray-900'
            : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
        )}
      >
        <code>{content}</code>
      </pre>
    </div>
  );
};

const PDFViewer = ({ src }: { src: string }) => {
  return (
    <div className='flex flex-col items-center'>
      <embed
        src={src}
        type='application/pdf'
        className='h-[50vh] w-full dark:border dark:border-gray-700'
      />
      <a
        href={src}
        target='_blank'
        rel='noopener noreferrer'
        className='mt-2 flex items-center text-accent hover:underline dark:text-darkAccent'
      >
        <DocumentIcon className='mr-1 h-4 w-4' />
        Open PDF in new tab
      </a>
    </div>
  );
};

export const FilePreview = ({ metadata }: { metadata: OffchainMetadata }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFilePreviewable, setIsFilePreviewable] = useState(false);
  const [file, setFile] = useState<Blob | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  const gatewayUrl = useMemo(() => {
    if (metadata.dataCid) {
      return EXTERNAL_ROUTES.gatewayObjectDownload(metadata.dataCid);
    }
    return null;
  }, [metadata.dataCid]);

  useEffect(() => {
    const fetchFile = async () => {
      if (
        metadata.uploadOptions?.encryption ||
        metadata.totalSize > MAX_FILE_SIZE ||
        !gatewayUrl
      ) {
        setIsFilePreviewable(false);
        setLoading(false);
        return;
      }
      setIsFilePreviewable(true);
      setLoading(true);
      try {
        const response = await fetch(gatewayUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch file: ${response.status} ${response.statusText}`,
          );
        }
        // Get the file as a blob
        const blob = await response.blob();
        setFile(blob);
        // For text-based files, also read the content
        const extension = metadata.name?.split('.').pop()?.toLowerCase() || '';
        const mimeType =
          'mimeType' in metadata
            ? (metadata.mimeType as string)?.toLowerCase() || ''
            : '';

        if (
          mimeType.startsWith('text/') ||
          [
            'js',
            'jsx',
            'ts',
            'tsx',
            'html',
            'css',
            'py',
            'java',
            'rb',
            'go',
            'rust',
            'php',
            'json',
            'md',
            'txt',
            'csv',
            'xml',
          ].includes(extension)
        ) {
          try {
            const text = await blob.text();
            setTextContent(text);
          } catch (err) {
            console.error('Failed to read text from blob:', err);
          }
        }
        setLoading(false);
      } catch (error) {
        console.error('Error fetching file:', error);
        setError(
          error instanceof Error ? error.message : 'Failed to fetch file',
        );
        setLoading(false);
      }
    };

    fetchFile();
  }, [metadata, gatewayUrl]);

  const fileData = useMemo(() => {
    return (
      file && {
        uri: gatewayUrl || URL.createObjectURL(file), // Prefer the direct gateway URL if available
        fileName: metadata.name,
        fileType:
          metadata.type === 'file' && 'mimeType' in metadata
            ? (metadata.mimeType as string)
            : undefined,
      }
    );
  }, [file, metadata, gatewayUrl]);

  const preview = useMemo(() => {
    const DirectGatewayLink = () =>
      gatewayUrl ? (
        <div className='mt-2 flex justify-end text-sm'>
          <a
            href={gatewayUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center text-accent hover:underline dark:text-darkAccent'
          >
            <ArrowTopRightOnSquareIcon className='mr-1 h-4 w-4' />
            View on gateway
          </a>
        </div>
      ) : null;

    if (loading) {
      return (
        <div className='flex h-[50vh] items-center justify-center'>
          <div className='h-12 w-12 animate-spin rounded-full border-b-2 border-accent dark:border-darkAccent'></div>
        </div>
      );
    }

    if (error) {
      return (
        <div className='rounded-md border border-red-300 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'>
          Error: {error}
          {gatewayUrl && <DirectGatewayLink />}
        </div>
      );
    }
    if (metadata.type === 'folder') {
      return (
        <>
          <FolderPreview metadata={metadata} />
          <DirectGatewayLink />
        </>
      );
    }
    if (!isFilePreviewable || !fileData) {
      return (
        <>
          <NoPreviewAvailable />
          {gatewayUrl && <DirectGatewayLink />}
        </>
      );
    }
    // Get file extension from name
    const extension = metadata.name?.split('.').pop()?.toLowerCase() || '';
    const mimeType =
      'mimeType' in metadata
        ? (metadata.mimeType as string)?.toLowerCase() || ''
        : '';

    if (
      mimeType.startsWith('image/') ||
      ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(
        extension,
      )
    ) {
      return (
        <>
          <ImageViewer src={fileData.uri} alt={fileData.fileName} />
          <DirectGatewayLink />
        </>
      );
    }
    if (mimeType === 'application/pdf' || extension === 'pdf') {
      return (
        <>
          <PDFViewer src={fileData.uri} />
          <DirectGatewayLink />
        </>
      );
    }
    if (
      mimeType.startsWith('video/') ||
      ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv'].includes(extension)
    ) {
      return (
        <>
          <VideoPlayer src={fileData.uri} type={fileData.fileType} />
          <DirectGatewayLink />
        </>
      );
    }
    if (
      mimeType.startsWith('audio/') ||
      ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(extension)
    ) {
      return (
        <>
          <AudioPlayer src={fileData.uri} />
          <DirectGatewayLink />
        </>
      );
    }
if (
      textContent &&
      (mimeType === 'application/json' || extension === 'json')
    ) {
      return (
        <>
          <JSONViewer content={textContent} />
          <DirectGatewayLink />
        </>
      );
    }
    if (
      textContent &&
      (mimeType.startsWith('text/') ||
        [
          'js',
          'jsx',
          'ts',
          'tsx',
          'html',
          'css',
          'py',
          'java',
          'rb',
          'go',
          'rust',
          'php',
          'txt',
          'md',
          'xml',
          'csv',
        ].includes(extension))
    ) {
      return (
        <>
          <TextViewer content={textContent} extension={extension} />
          <DirectGatewayLink />
        </>
      );
    }
    if ((mimeType === 'application/json' || extension === 'json') && file) {
      return (
        <>
          <Arguments file={file} />
          <DirectGatewayLink />
        </>
      );
    }
    return (
      <div className='flex flex-col items-center'>
        <object
          className='h-[50vh] w-full border dark:border-gray-700'
          data={fileData.uri}
          type={fileData.fileType}
          aria-label={fileData.fileName}
          title={fileData.fileName}
        />
        <div className='mt-4 text-sm text-gray-500 dark:text-gray-400'>
          {fileData.fileType || extension.toUpperCase()} file preview
        </div>
        <DirectGatewayLink />
      </div>
    );
  }, [
    loading,
    error,
    metadata,
    file,
    isFilePreviewable,
    fileData,
    textContent,
    gatewayUrl,
  ]);

  return preview;
};
