import { gql } from '@apollo/client';

export const GET_SHARED_FILES = gql`
  query GetSharedFiles(
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
              marked_as_deleted: { _is_null: true }
              is_admin: { _eq: false }
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
          order_by: { block_published_on: desc_nulls_last }
          limit: 1
        ) {
          block_published_on
          tx_published_on
        }
        minimumBlockDepth: nodes(
          order_by: { block_published_on: desc_nulls_last }
          limit: 1
        ) {
          block_published_on
          tx_published_on
        }
        publishedNodes: nodes_aggregate(
          where: { block_published_on: { _is_null: false } }
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
