'use client';
import { UploadedObjectInformation } from '../../components/UploadedObjectInformation';
import { NetworkId } from '../../constants/networks';
import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';

export const ObjectDetails = ({
  metadata,
}: {
  metadata: UploadedObjectMetadata;
}) => {
  return <UploadedObjectInformation object={metadata} />;
};

export const getObjectDetailsPath = (networkId: NetworkId, cid: string) => {
  return `/${networkId}/drive/metadata/${cid}`;
};
