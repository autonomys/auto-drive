import { gql } from '@apollo/client';

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
