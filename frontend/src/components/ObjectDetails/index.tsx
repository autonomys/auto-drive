'use client';
import { UploadedObjectInformation } from 'components/UploadedObjectInformation';
import { ObjectInformation } from '@auto-drive/models';

export const ObjectDetails = ({
  metadata,
}: {
  metadata: ObjectInformation;
}) => {
  return <UploadedObjectInformation object={metadata} />;
};
