import { gql } from '@apollo/client';

export const GET_USER_FILES = gql`
  query GetMyFiles(
    $oauthUserId: String!
    $oauthProvider: String!
    $limit: Int!
    $offset: Int!
  ) {
    metadata(
      distinct_on: root_cid
      where: {
        root_metadata: {
          object_ownership: {
            _and: {
              oauth_user_id: { _eq: $oauthUserId }
              oauth_provider: { _eq: $oauthProvider }
              is_admin: { _eq: true }
              marked_as_deleted: { _is_null: true }
            }
          }
        }
      }
      limit: $limit
      offset: $offset
    ) {
      root_metadata {
        cid: head_cid
        type: metadata(path: "type")
        name: metadata(path: "name")
        mimeType: metadata(path: "mimeType")
        size: metadata(path: "totalSize")
        children: metadata(path: "children")
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
          oauth_provider
          oauth_user_id
          is_admin
        }
      }
    }
    metadata_aggregate(
      distinct_on: root_cid
      where: {
        root_metadata: {
          object_ownership: {
            _and: {
              oauth_user_id: { _eq: $oauthUserId }
              oauth_provider: { _eq: $oauthProvider }
              is_admin: { _eq: true }
            }
          }
        }
      }
    ) {
      aggregate {
        count
      }
    }
  }
`;
