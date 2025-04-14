import {
  PhotoIcon,
  DocumentIcon,
  ArchiveBoxIcon,
  MusicalNoteIcon,
  FilmIcon,
  DocumentTextIcon,
  TableCellsIcon,
  DocumentChartBarIcon,
  FolderIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline';
import { Braces } from 'lucide-react';

export type FileIconProps = {
  fileType: string;
  className?: string;
};

export function FileIcons({
  fileType,
  className = 'h-6 w-6 text-blue-900 dark:text-blue-100',
}: FileIconProps) {
  // Helper function to check if the file type starts with a specific prefix
  const isType = (prefix: string) => fileType.toLowerCase().startsWith(prefix);

  // Determine which icon to use based on the file type
  if (isType('image/')) {
    return <PhotoIcon className={className} />;
  } else if (isType('video/')) {
    return <FilmIcon className={className} />;
  } else if (isType('audio/')) {
    return <MusicalNoteIcon className={className} />;
  } else if (isType('application/pdf')) {
    return <DocumentTextIcon className={className} />;
  } else if (
    isType('application/zip') ||
    isType('application/x-rar') ||
    isType('application/x-7z') ||
    isType('application/x-tar') ||
    isType('application/gzip')
  ) {
    return <ArchiveBoxIcon className={className} />;
  } else if (
    isType('application/json') ||
    isType('text/javascript') ||
    isType('application/javascript')
  ) {
    return <Braces className={className} />;
  } else if (isType('text/html') || isType('text/xml')) {
    return <CodeBracketIcon className={className} />;
  } else if (
    isType('application/vnd.ms-excel') ||
    isType(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ) ||
    isType('text/csv')
  ) {
    return <TableCellsIcon className={className} />;
  } else if (
    isType('application/vnd.ms-powerpoint') ||
    isType(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
  ) {
    return <DocumentChartBarIcon className={className} />;
  } else if (isType('text/')) {
    return <DocumentTextIcon className={className} />;
  } else if (isType('application/')) {
    return <DocumentIcon className={className} />;
  } else if (isType('folder')) {
    return <FolderIcon className={className} />;
  }
  // Default fallback icon
  return <DocumentIcon className={className} />;
}
