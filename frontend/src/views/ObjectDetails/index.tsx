'use client';
import { UploadedObjectInformation } from '../../components/UploadedObjectInformation';
import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';

export const ObjectDetails = ({
  metadata,
}: {
  metadata: UploadedObjectMetadata;
}) => {
  return <UploadedObjectInformation object={metadata} />;
};
