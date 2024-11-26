import { gql } from '@apollo/client';
import { GetMetadataByHeadCidQuery } from '../../../../../gql/graphql';
import {
  OwnerRole,
  UploadedObjectMetadata,
} from '../../../../models/UploadedObjectMetadata';

export const GET_METADATA_BY_HEAD_CID = gql`
  query GetMetadataByHeadCID($headCid: String!) {
    metadata(
      distinct_on: root_cid
      where: { _and: { head_cid: { _eq: $headCid } } }
    ) {
      metadata
      maximumBlockDepth: nodes(
        order_by: { transaction_result: { created_at: desc_nulls_first } }
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      minimumBlockDepth: nodes(
        order_by: { transaction_result: { created_at: asc } }
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      publishedNodes: nodes_aggregate(
        where: {
          transaction_result: { transaction_result: { _is_null: false } }
        }
      ) {
        aggregate {
          count
        }
      }
      archivedNodes: nodes_aggregate(
        where: { piece_offset: { _is_null: false } }
      ) {
        aggregate {
          count
        }
      }
      totalNodes: nodes_aggregate {
        aggregate {
          count
        }
      }
      object_ownership {
        user {
          public_id
        }
        is_admin
      }
    }
  }
`;

export const mapObjectInformationFromQueryResult = (
  result: GetMetadataByHeadCidQuery,
): UploadedObjectMetadata => {
  const metadata = result.metadata[0];
  return {
    metadata: metadata.metadata,
    uploadStatus: {
      uploadedNodes: metadata.publishedNodes?.aggregate?.count ?? 0,
      totalNodes: metadata.totalNodes?.aggregate?.count ?? 0,
      archivedNodes: metadata.archivedNodes?.aggregate?.count ?? 0,
      minimumBlockDepth:
        metadata.minimumBlockDepth[0]?.transaction_result?.blockNumber ?? null,
      maximumBlockDepth:
        metadata.maximumBlockDepth[0]?.transaction_result?.blockNumber ?? null,
    },
    owners: metadata.object_ownership.map((owner) => ({
      publicId: owner.user?.public_id ?? '',
      role: owner.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
    })),
  };
};
