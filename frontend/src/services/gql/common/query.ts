import { gql } from '@apollo/client';

export const GET_METADATA_BY_HEAD_CID = gql`
  query GetMetadataByHeadCID($headCid: String!) {
    metadata(
      distinct_on: root_cid
      where: {
        _or: [
          { head_cid: { _ilike: $headCid } }
          { name: { _ilike: $headCid } }
        ]
      }
    ) {
      metadata
      published_objects {
        id
      }
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
        oauth_user_id
        oauth_provider
        is_admin
      }
    }
  }
`;

export const SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME = gql`
  query SearchGlobalMetadataByCIDOrName($search: String!, $limit: Int!) {
    metadata(
      distinct_on: root_cid
      where: {
        _or: [{ head_cid: { _ilike: $search } }, { name: { _ilike: $search } }]
      }
      limit: $limit
    ) {
      type: metadata(path: "type")
      name
      size: metadata(path: "totalSize")
      cid: head_cid
    }
  }
`;

export const SEARCH_USER_METADATA_BY_CID_OR_NAME = gql`
  query SearchUserMetadataByCIDOrName(
    $search: String!
    $oauthUserId: String!
    $oauthProvider: String!
    $limit: Int!
  ) {
    metadata(
      distinct_on: root_cid
      where: {
        _and: [
          {
            _or: [
              { head_cid: { _ilike: $search } }
              { name: { _ilike: $search } }
            ]
          }
          {
            object_ownership: {
              _and: {
                oauth_user_id: { _eq: $oauthUserId }
                oauth_provider: { _eq: $oauthProvider }
              }
            }
          }
        ]
      }
      limit: $limit
    ) {
      type: metadata(path: "type")
      name
      size: metadata(path: "totalSize")
      cid: head_cid
    }
  }
`;

export const GET_ALL_USERS_WITH_SUBSCRIPTIONS = gql`
  query GetAllUsersWithSubscriptions {
    users {
      publicId: public_id
      role
      oauthProvider: oauth_provider
      oauthUserId: oauth_user_id
      user_membership {
        subscription {
          id
          organizationId: organization_id
          uploadLimit: upload_limit
          downloadLimit: download_limit
          granularity
        }
      }
    }
  }
`;
