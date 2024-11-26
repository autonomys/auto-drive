import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  bigint: { input: any; output: any; }
  jsonb: { input: any; output: any; }
  timestamp: { input: any; output: any; }
};

/** Boolean expression to compare columns of type "Boolean". All fields are combined with logical 'AND'. */
export type Boolean_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Boolean']['input']>;
  _gt?: InputMaybe<Scalars['Boolean']['input']>;
  _gte?: InputMaybe<Scalars['Boolean']['input']>;
  _in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Boolean']['input']>;
  _lte?: InputMaybe<Scalars['Boolean']['input']>;
  _neq?: InputMaybe<Scalars['Boolean']['input']>;
  _nin?: InputMaybe<Array<Scalars['Boolean']['input']>>;
};

/** Boolean expression to compare columns of type "Int". All fields are combined with logical 'AND'. */
export type Int_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['Int']['input']>;
  _gt?: InputMaybe<Scalars['Int']['input']>;
  _gte?: InputMaybe<Scalars['Int']['input']>;
  _in?: InputMaybe<Array<Scalars['Int']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['Int']['input']>;
  _lte?: InputMaybe<Scalars['Int']['input']>;
  _neq?: InputMaybe<Scalars['Int']['input']>;
  _nin?: InputMaybe<Array<Scalars['Int']['input']>>;
};

/** Boolean expression to compare columns of type "String". All fields are combined with logical 'AND'. */
export type String_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['String']['input']>;
  _gt?: InputMaybe<Scalars['String']['input']>;
  _gte?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given case-insensitive pattern */
  _ilike?: InputMaybe<Scalars['String']['input']>;
  _in?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the column match the given POSIX regular expression, case insensitive */
  _iregex?: InputMaybe<Scalars['String']['input']>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  /** does the column match the given pattern */
  _like?: InputMaybe<Scalars['String']['input']>;
  _lt?: InputMaybe<Scalars['String']['input']>;
  _lte?: InputMaybe<Scalars['String']['input']>;
  _neq?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given case-insensitive pattern */
  _nilike?: InputMaybe<Scalars['String']['input']>;
  _nin?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the column NOT match the given POSIX regular expression, case insensitive */
  _niregex?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given pattern */
  _nlike?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given POSIX regular expression, case sensitive */
  _nregex?: InputMaybe<Scalars['String']['input']>;
  /** does the column NOT match the given SQL regular expression */
  _nsimilar?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given POSIX regular expression, case sensitive */
  _regex?: InputMaybe<Scalars['String']['input']>;
  /** does the column match the given SQL regular expression */
  _similar?: InputMaybe<Scalars['String']['input']>;
};

/** columns and relationships of "api_keys" */
export type Api_Keys = {
  __typename?: 'api_keys';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  deleted_at?: Maybe<Scalars['timestamp']['output']>;
  id: Scalars['String']['output'];
  oauth_provider: Scalars['String']['output'];
  oauth_user_id: Scalars['String']['output'];
  secret: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "api_keys" */
export type Api_Keys_Aggregate = {
  __typename?: 'api_keys_aggregate';
  aggregate?: Maybe<Api_Keys_Aggregate_Fields>;
  nodes: Array<Api_Keys>;
};

/** aggregate fields of "api_keys" */
export type Api_Keys_Aggregate_Fields = {
  __typename?: 'api_keys_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Api_Keys_Max_Fields>;
  min?: Maybe<Api_Keys_Min_Fields>;
};


/** aggregate fields of "api_keys" */
export type Api_Keys_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Api_Keys_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "api_keys". All fields are combined with a logical 'AND'. */
export type Api_Keys_Bool_Exp = {
  _and?: InputMaybe<Array<Api_Keys_Bool_Exp>>;
  _not?: InputMaybe<Api_Keys_Bool_Exp>;
  _or?: InputMaybe<Array<Api_Keys_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  deleted_at?: InputMaybe<Timestamp_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  oauth_provider?: InputMaybe<String_Comparison_Exp>;
  oauth_user_id?: InputMaybe<String_Comparison_Exp>;
  secret?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Api_Keys_Max_Fields = {
  __typename?: 'api_keys_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  deleted_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  secret?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Api_Keys_Min_Fields = {
  __typename?: 'api_keys_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  deleted_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  secret?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** Ordering options when selecting data from "api_keys". */
export type Api_Keys_Order_By = {
  created_at?: InputMaybe<Order_By>;
  deleted_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  secret?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** select columns of table "api_keys" */
export enum Api_Keys_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  DeletedAt = 'deleted_at',
  /** column name */
  Id = 'id',
  /** column name */
  OauthProvider = 'oauth_provider',
  /** column name */
  OauthUserId = 'oauth_user_id',
  /** column name */
  Secret = 'secret',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** Streaming cursor of the table "api_keys" */
export type Api_Keys_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Api_Keys_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Api_Keys_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  deleted_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  secret?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** Boolean expression to compare columns of type "bigint". All fields are combined with logical 'AND'. */
export type Bigint_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['bigint']['input']>;
  _gt?: InputMaybe<Scalars['bigint']['input']>;
  _gte?: InputMaybe<Scalars['bigint']['input']>;
  _in?: InputMaybe<Array<Scalars['bigint']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['bigint']['input']>;
  _lte?: InputMaybe<Scalars['bigint']['input']>;
  _neq?: InputMaybe<Scalars['bigint']['input']>;
  _nin?: InputMaybe<Array<Scalars['bigint']['input']>>;
};

/** ordering argument of a cursor */
export enum Cursor_Ordering {
  /** ascending ordering of the cursor */
  Asc = 'ASC',
  /** descending ordering of the cursor */
  Desc = 'DESC'
}

/** columns and relationships of "interactions" */
export type Interactions = {
  __typename?: 'interactions';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id: Scalars['String']['output'];
  size: Scalars['bigint']['output'];
  subscription_id: Scalars['String']['output'];
  type: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "interactions" */
export type Interactions_Aggregate = {
  __typename?: 'interactions_aggregate';
  aggregate?: Maybe<Interactions_Aggregate_Fields>;
  nodes: Array<Interactions>;
};

/** aggregate fields of "interactions" */
export type Interactions_Aggregate_Fields = {
  __typename?: 'interactions_aggregate_fields';
  avg?: Maybe<Interactions_Avg_Fields>;
  count: Scalars['Int']['output'];
  max?: Maybe<Interactions_Max_Fields>;
  min?: Maybe<Interactions_Min_Fields>;
  stddev?: Maybe<Interactions_Stddev_Fields>;
  stddev_pop?: Maybe<Interactions_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Interactions_Stddev_Samp_Fields>;
  sum?: Maybe<Interactions_Sum_Fields>;
  var_pop?: Maybe<Interactions_Var_Pop_Fields>;
  var_samp?: Maybe<Interactions_Var_Samp_Fields>;
  variance?: Maybe<Interactions_Variance_Fields>;
};


/** aggregate fields of "interactions" */
export type Interactions_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Interactions_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** aggregate avg on columns */
export type Interactions_Avg_Fields = {
  __typename?: 'interactions_avg_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

/** Boolean expression to filter rows from the table "interactions". All fields are combined with a logical 'AND'. */
export type Interactions_Bool_Exp = {
  _and?: InputMaybe<Array<Interactions_Bool_Exp>>;
  _not?: InputMaybe<Interactions_Bool_Exp>;
  _or?: InputMaybe<Array<Interactions_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  size?: InputMaybe<Bigint_Comparison_Exp>;
  subscription_id?: InputMaybe<String_Comparison_Exp>;
  type?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Interactions_Max_Fields = {
  __typename?: 'interactions_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  size?: Maybe<Scalars['bigint']['output']>;
  subscription_id?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Interactions_Min_Fields = {
  __typename?: 'interactions_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  size?: Maybe<Scalars['bigint']['output']>;
  subscription_id?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** Ordering options when selecting data from "interactions". */
export type Interactions_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  size?: InputMaybe<Order_By>;
  subscription_id?: InputMaybe<Order_By>;
  type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** select columns of table "interactions" */
export enum Interactions_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  Size = 'size',
  /** column name */
  SubscriptionId = 'subscription_id',
  /** column name */
  Type = 'type',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** aggregate stddev on columns */
export type Interactions_Stddev_Fields = {
  __typename?: 'interactions_stddev_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate stddev_pop on columns */
export type Interactions_Stddev_Pop_Fields = {
  __typename?: 'interactions_stddev_pop_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate stddev_samp on columns */
export type Interactions_Stddev_Samp_Fields = {
  __typename?: 'interactions_stddev_samp_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

/** Streaming cursor of the table "interactions" */
export type Interactions_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Interactions_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Interactions_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  size?: InputMaybe<Scalars['bigint']['input']>;
  subscription_id?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate sum on columns */
export type Interactions_Sum_Fields = {
  __typename?: 'interactions_sum_fields';
  size?: Maybe<Scalars['bigint']['output']>;
};

/** aggregate var_pop on columns */
export type Interactions_Var_Pop_Fields = {
  __typename?: 'interactions_var_pop_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate var_samp on columns */
export type Interactions_Var_Samp_Fields = {
  __typename?: 'interactions_var_samp_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate variance on columns */
export type Interactions_Variance_Fields = {
  __typename?: 'interactions_variance_fields';
  size?: Maybe<Scalars['Float']['output']>;
};

export type Jsonb_Cast_Exp = {
  String?: InputMaybe<String_Comparison_Exp>;
};

/** Boolean expression to compare columns of type "jsonb". All fields are combined with logical 'AND'. */
export type Jsonb_Comparison_Exp = {
  _cast?: InputMaybe<Jsonb_Cast_Exp>;
  /** is the column contained in the given json value */
  _contained_in?: InputMaybe<Scalars['jsonb']['input']>;
  /** does the column contain the given json value at the top level */
  _contains?: InputMaybe<Scalars['jsonb']['input']>;
  _eq?: InputMaybe<Scalars['jsonb']['input']>;
  _gt?: InputMaybe<Scalars['jsonb']['input']>;
  _gte?: InputMaybe<Scalars['jsonb']['input']>;
  /** does the string exist as a top-level key in the column */
  _has_key?: InputMaybe<Scalars['String']['input']>;
  /** do all of these strings exist as top-level keys in the column */
  _has_keys_all?: InputMaybe<Array<Scalars['String']['input']>>;
  /** do any of these strings exist as top-level keys in the column */
  _has_keys_any?: InputMaybe<Array<Scalars['String']['input']>>;
  _in?: InputMaybe<Array<Scalars['jsonb']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['jsonb']['input']>;
  _lte?: InputMaybe<Scalars['jsonb']['input']>;
  _neq?: InputMaybe<Scalars['jsonb']['input']>;
  _nin?: InputMaybe<Array<Scalars['jsonb']['input']>>;
};

/** columns and relationships of "metadata" */
export type Metadata = {
  __typename?: 'metadata';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  /** An object relationship */
  head?: Maybe<Nodes>;
  head_cid: Scalars['String']['output'];
  metadata?: Maybe<Scalars['jsonb']['output']>;
  /** An array relationship */
  metadata_list_by_root_id: Array<Metadata>;
  /** An aggregate relationship */
  metadata_list_by_root_id_aggregate: Metadata_Aggregate;
  /** An array relationship */
  nodes: Array<Nodes>;
  /** An aggregate relationship */
  nodes_aggregate: Nodes_Aggregate;
  /** An array relationship */
  object_ownership: Array<Object_Ownership>;
  /** An aggregate relationship */
  object_ownership_aggregate: Object_Ownership_Aggregate;
  root_cid: Scalars['String']['output'];
  /** An object relationship */
  root_metadata?: Maybe<Metadata>;
  updated_at: Scalars['timestamp']['output'];
};


/** columns and relationships of "metadata" */
export type MetadataMetadataArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};


/** columns and relationships of "metadata" */
export type MetadataMetadata_List_By_Root_IdArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


/** columns and relationships of "metadata" */
export type MetadataMetadata_List_By_Root_Id_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


/** columns and relationships of "metadata" */
export type MetadataNodesArgs = {
  distinct_on?: InputMaybe<Array<Nodes_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Nodes_Order_By>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


/** columns and relationships of "metadata" */
export type MetadataNodes_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Nodes_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Nodes_Order_By>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


/** columns and relationships of "metadata" */
export type MetadataObject_OwnershipArgs = {
  distinct_on?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Object_Ownership_Order_By>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};


/** columns and relationships of "metadata" */
export type MetadataObject_Ownership_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Object_Ownership_Order_By>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};

/** aggregated selection of "metadata" */
export type Metadata_Aggregate = {
  __typename?: 'metadata_aggregate';
  aggregate?: Maybe<Metadata_Aggregate_Fields>;
  nodes: Array<Metadata>;
};

export type Metadata_Aggregate_Bool_Exp = {
  count?: InputMaybe<Metadata_Aggregate_Bool_Exp_Count>;
};

export type Metadata_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Metadata_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Metadata_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "metadata" */
export type Metadata_Aggregate_Fields = {
  __typename?: 'metadata_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Metadata_Max_Fields>;
  min?: Maybe<Metadata_Min_Fields>;
};


/** aggregate fields of "metadata" */
export type Metadata_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Metadata_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "metadata" */
export type Metadata_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Metadata_Max_Order_By>;
  min?: InputMaybe<Metadata_Min_Order_By>;
};

/** Boolean expression to filter rows from the table "metadata". All fields are combined with a logical 'AND'. */
export type Metadata_Bool_Exp = {
  _and?: InputMaybe<Array<Metadata_Bool_Exp>>;
  _not?: InputMaybe<Metadata_Bool_Exp>;
  _or?: InputMaybe<Array<Metadata_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  head?: InputMaybe<Nodes_Bool_Exp>;
  head_cid?: InputMaybe<String_Comparison_Exp>;
  metadata?: InputMaybe<Jsonb_Comparison_Exp>;
  metadata_list_by_root_id?: InputMaybe<Metadata_Bool_Exp>;
  metadata_list_by_root_id_aggregate?: InputMaybe<Metadata_Aggregate_Bool_Exp>;
  nodes?: InputMaybe<Nodes_Bool_Exp>;
  nodes_aggregate?: InputMaybe<Nodes_Aggregate_Bool_Exp>;
  object_ownership?: InputMaybe<Object_Ownership_Bool_Exp>;
  object_ownership_aggregate?: InputMaybe<Object_Ownership_Aggregate_Bool_Exp>;
  root_cid?: InputMaybe<String_Comparison_Exp>;
  root_metadata?: InputMaybe<Metadata_Bool_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Metadata_Max_Fields = {
  __typename?: 'metadata_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by max() on columns of table "metadata" */
export type Metadata_Max_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Metadata_Min_Fields = {
  __typename?: 'metadata_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by min() on columns of table "metadata" */
export type Metadata_Min_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "metadata". */
export type Metadata_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head?: InputMaybe<Nodes_Order_By>;
  head_cid?: InputMaybe<Order_By>;
  metadata?: InputMaybe<Order_By>;
  metadata_list_by_root_id_aggregate?: InputMaybe<Metadata_Aggregate_Order_By>;
  nodes_aggregate?: InputMaybe<Nodes_Aggregate_Order_By>;
  object_ownership_aggregate?: InputMaybe<Object_Ownership_Aggregate_Order_By>;
  root_cid?: InputMaybe<Order_By>;
  root_metadata?: InputMaybe<Metadata_Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** select columns of table "metadata" */
export enum Metadata_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  HeadCid = 'head_cid',
  /** column name */
  Metadata = 'metadata',
  /** column name */
  RootCid = 'root_cid',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** Streaming cursor of the table "metadata" */
export type Metadata_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Metadata_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Metadata_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** columns and relationships of "nodes" */
export type Nodes = {
  __typename?: 'nodes';
  cid: Scalars['String']['output'];
  encoded_node?: Maybe<Scalars['String']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  /** An array relationship */
  nodes: Array<Metadata>;
  /** An aggregate relationship */
  nodes_aggregate: Metadata_Aggregate;
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
  /** An object relationship */
  root?: Maybe<Nodes>;
  root_cid?: Maybe<Scalars['String']['output']>;
  /** An object relationship */
  transaction_result?: Maybe<Transaction_Results>;
  type?: Maybe<Scalars['String']['output']>;
};


/** columns and relationships of "nodes" */
export type NodesNodesArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


/** columns and relationships of "nodes" */
export type NodesNodes_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};

/** aggregated selection of "nodes" */
export type Nodes_Aggregate = {
  __typename?: 'nodes_aggregate';
  aggregate?: Maybe<Nodes_Aggregate_Fields>;
  nodes: Array<Nodes>;
};

export type Nodes_Aggregate_Bool_Exp = {
  count?: InputMaybe<Nodes_Aggregate_Bool_Exp_Count>;
};

export type Nodes_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Nodes_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Nodes_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "nodes" */
export type Nodes_Aggregate_Fields = {
  __typename?: 'nodes_aggregate_fields';
  avg?: Maybe<Nodes_Avg_Fields>;
  count: Scalars['Int']['output'];
  max?: Maybe<Nodes_Max_Fields>;
  min?: Maybe<Nodes_Min_Fields>;
  stddev?: Maybe<Nodes_Stddev_Fields>;
  stddev_pop?: Maybe<Nodes_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Nodes_Stddev_Samp_Fields>;
  sum?: Maybe<Nodes_Sum_Fields>;
  var_pop?: Maybe<Nodes_Var_Pop_Fields>;
  var_samp?: Maybe<Nodes_Var_Samp_Fields>;
  variance?: Maybe<Nodes_Variance_Fields>;
};


/** aggregate fields of "nodes" */
export type Nodes_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Nodes_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "nodes" */
export type Nodes_Aggregate_Order_By = {
  avg?: InputMaybe<Nodes_Avg_Order_By>;
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Nodes_Max_Order_By>;
  min?: InputMaybe<Nodes_Min_Order_By>;
  stddev?: InputMaybe<Nodes_Stddev_Order_By>;
  stddev_pop?: InputMaybe<Nodes_Stddev_Pop_Order_By>;
  stddev_samp?: InputMaybe<Nodes_Stddev_Samp_Order_By>;
  sum?: InputMaybe<Nodes_Sum_Order_By>;
  var_pop?: InputMaybe<Nodes_Var_Pop_Order_By>;
  var_samp?: InputMaybe<Nodes_Var_Samp_Order_By>;
  variance?: InputMaybe<Nodes_Variance_Order_By>;
};

/** aggregate avg on columns */
export type Nodes_Avg_Fields = {
  __typename?: 'nodes_avg_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by avg() on columns of table "nodes" */
export type Nodes_Avg_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "nodes". All fields are combined with a logical 'AND'. */
export type Nodes_Bool_Exp = {
  _and?: InputMaybe<Array<Nodes_Bool_Exp>>;
  _not?: InputMaybe<Nodes_Bool_Exp>;
  _or?: InputMaybe<Array<Nodes_Bool_Exp>>;
  cid?: InputMaybe<String_Comparison_Exp>;
  encoded_node?: InputMaybe<String_Comparison_Exp>;
  head_cid?: InputMaybe<String_Comparison_Exp>;
  nodes?: InputMaybe<Metadata_Bool_Exp>;
  nodes_aggregate?: InputMaybe<Metadata_Aggregate_Bool_Exp>;
  piece_index?: InputMaybe<Int_Comparison_Exp>;
  piece_offset?: InputMaybe<Int_Comparison_Exp>;
  root?: InputMaybe<Nodes_Bool_Exp>;
  root_cid?: InputMaybe<String_Comparison_Exp>;
  transaction_result?: InputMaybe<Transaction_Results_Bool_Exp>;
  type?: InputMaybe<String_Comparison_Exp>;
};

/** aggregate max on columns */
export type Nodes_Max_Fields = {
  __typename?: 'nodes_max_fields';
  cid?: Maybe<Scalars['String']['output']>;
  encoded_node?: Maybe<Scalars['String']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
};

/** order by max() on columns of table "nodes" */
export type Nodes_Max_Order_By = {
  cid?: InputMaybe<Order_By>;
  encoded_node?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  type?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Nodes_Min_Fields = {
  __typename?: 'nodes_min_fields';
  cid?: Maybe<Scalars['String']['output']>;
  encoded_node?: Maybe<Scalars['String']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
};

/** order by min() on columns of table "nodes" */
export type Nodes_Min_Order_By = {
  cid?: InputMaybe<Order_By>;
  encoded_node?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  type?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "nodes". */
export type Nodes_Order_By = {
  cid?: InputMaybe<Order_By>;
  encoded_node?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  nodes_aggregate?: InputMaybe<Metadata_Aggregate_Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
  root?: InputMaybe<Nodes_Order_By>;
  root_cid?: InputMaybe<Order_By>;
  transaction_result?: InputMaybe<Transaction_Results_Order_By>;
  type?: InputMaybe<Order_By>;
};

/** select columns of table "nodes" */
export enum Nodes_Select_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  EncodedNode = 'encoded_node',
  /** column name */
  HeadCid = 'head_cid',
  /** column name */
  PieceIndex = 'piece_index',
  /** column name */
  PieceOffset = 'piece_offset',
  /** column name */
  RootCid = 'root_cid',
  /** column name */
  Type = 'type'
}

/** aggregate stddev on columns */
export type Nodes_Stddev_Fields = {
  __typename?: 'nodes_stddev_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by stddev() on columns of table "nodes" */
export type Nodes_Stddev_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate stddev_pop on columns */
export type Nodes_Stddev_Pop_Fields = {
  __typename?: 'nodes_stddev_pop_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by stddev_pop() on columns of table "nodes" */
export type Nodes_Stddev_Pop_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate stddev_samp on columns */
export type Nodes_Stddev_Samp_Fields = {
  __typename?: 'nodes_stddev_samp_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by stddev_samp() on columns of table "nodes" */
export type Nodes_Stddev_Samp_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** Streaming cursor of the table "nodes" */
export type Nodes_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Nodes_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Nodes_Stream_Cursor_Value_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  encoded_node?: InputMaybe<Scalars['String']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  piece_index?: InputMaybe<Scalars['Int']['input']>;
  piece_offset?: InputMaybe<Scalars['Int']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
};

/** aggregate sum on columns */
export type Nodes_Sum_Fields = {
  __typename?: 'nodes_sum_fields';
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
};

/** order by sum() on columns of table "nodes" */
export type Nodes_Sum_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate var_pop on columns */
export type Nodes_Var_Pop_Fields = {
  __typename?: 'nodes_var_pop_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by var_pop() on columns of table "nodes" */
export type Nodes_Var_Pop_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate var_samp on columns */
export type Nodes_Var_Samp_Fields = {
  __typename?: 'nodes_var_samp_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by var_samp() on columns of table "nodes" */
export type Nodes_Var_Samp_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate variance on columns */
export type Nodes_Variance_Fields = {
  __typename?: 'nodes_variance_fields';
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by variance() on columns of table "nodes" */
export type Nodes_Variance_Order_By = {
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** columns and relationships of "object_ownership" */
export type Object_Ownership = {
  __typename?: 'object_ownership';
  cid: Scalars['String']['output'];
  created_at?: Maybe<Scalars['timestamp']['output']>;
  is_admin?: Maybe<Scalars['Boolean']['output']>;
  marked_as_deleted?: Maybe<Scalars['timestamp']['output']>;
  /** An object relationship */
  metadata?: Maybe<Metadata>;
  oauth_provider: Scalars['String']['output'];
  oauth_user_id: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
  /** An object relationship */
  user?: Maybe<Users>;
};

/** aggregated selection of "object_ownership" */
export type Object_Ownership_Aggregate = {
  __typename?: 'object_ownership_aggregate';
  aggregate?: Maybe<Object_Ownership_Aggregate_Fields>;
  nodes: Array<Object_Ownership>;
};

export type Object_Ownership_Aggregate_Bool_Exp = {
  bool_and?: InputMaybe<Object_Ownership_Aggregate_Bool_Exp_Bool_And>;
  bool_or?: InputMaybe<Object_Ownership_Aggregate_Bool_Exp_Bool_Or>;
  count?: InputMaybe<Object_Ownership_Aggregate_Bool_Exp_Count>;
};

export type Object_Ownership_Aggregate_Bool_Exp_Bool_And = {
  arguments: Object_Ownership_Select_Column_Object_Ownership_Aggregate_Bool_Exp_Bool_And_Arguments_Columns;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Object_Ownership_Bool_Exp>;
  predicate: Boolean_Comparison_Exp;
};

export type Object_Ownership_Aggregate_Bool_Exp_Bool_Or = {
  arguments: Object_Ownership_Select_Column_Object_Ownership_Aggregate_Bool_Exp_Bool_Or_Arguments_Columns;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Object_Ownership_Bool_Exp>;
  predicate: Boolean_Comparison_Exp;
};

export type Object_Ownership_Aggregate_Bool_Exp_Count = {
  arguments?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Object_Ownership_Bool_Exp>;
  predicate: Int_Comparison_Exp;
};

/** aggregate fields of "object_ownership" */
export type Object_Ownership_Aggregate_Fields = {
  __typename?: 'object_ownership_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Object_Ownership_Max_Fields>;
  min?: Maybe<Object_Ownership_Min_Fields>;
};


/** aggregate fields of "object_ownership" */
export type Object_Ownership_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** order by aggregate values of table "object_ownership" */
export type Object_Ownership_Aggregate_Order_By = {
  count?: InputMaybe<Order_By>;
  max?: InputMaybe<Object_Ownership_Max_Order_By>;
  min?: InputMaybe<Object_Ownership_Min_Order_By>;
};

/** Boolean expression to filter rows from the table "object_ownership". All fields are combined with a logical 'AND'. */
export type Object_Ownership_Bool_Exp = {
  _and?: InputMaybe<Array<Object_Ownership_Bool_Exp>>;
  _not?: InputMaybe<Object_Ownership_Bool_Exp>;
  _or?: InputMaybe<Array<Object_Ownership_Bool_Exp>>;
  cid?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  is_admin?: InputMaybe<Boolean_Comparison_Exp>;
  marked_as_deleted?: InputMaybe<Timestamp_Comparison_Exp>;
  metadata?: InputMaybe<Metadata_Bool_Exp>;
  oauth_provider?: InputMaybe<String_Comparison_Exp>;
  oauth_user_id?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
  user?: InputMaybe<Users_Bool_Exp>;
};

/** aggregate max on columns */
export type Object_Ownership_Max_Fields = {
  __typename?: 'object_ownership_max_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  marked_as_deleted?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by max() on columns of table "object_ownership" */
export type Object_Ownership_Max_Order_By = {
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  marked_as_deleted?: InputMaybe<Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Object_Ownership_Min_Fields = {
  __typename?: 'object_ownership_min_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  marked_as_deleted?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by min() on columns of table "object_ownership" */
export type Object_Ownership_Min_Order_By = {
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  marked_as_deleted?: InputMaybe<Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** Ordering options when selecting data from "object_ownership". */
export type Object_Ownership_Order_By = {
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  is_admin?: InputMaybe<Order_By>;
  marked_as_deleted?: InputMaybe<Order_By>;
  metadata?: InputMaybe<Metadata_Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
  user?: InputMaybe<Users_Order_By>;
};

/** select columns of table "object_ownership" */
export enum Object_Ownership_Select_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  IsAdmin = 'is_admin',
  /** column name */
  MarkedAsDeleted = 'marked_as_deleted',
  /** column name */
  OauthProvider = 'oauth_provider',
  /** column name */
  OauthUserId = 'oauth_user_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** select "object_ownership_aggregate_bool_exp_bool_and_arguments_columns" columns of table "object_ownership" */
export enum Object_Ownership_Select_Column_Object_Ownership_Aggregate_Bool_Exp_Bool_And_Arguments_Columns {
  /** column name */
  IsAdmin = 'is_admin'
}

/** select "object_ownership_aggregate_bool_exp_bool_or_arguments_columns" columns of table "object_ownership" */
export enum Object_Ownership_Select_Column_Object_Ownership_Aggregate_Bool_Exp_Bool_Or_Arguments_Columns {
  /** column name */
  IsAdmin = 'is_admin'
}

/** Streaming cursor of the table "object_ownership" */
export type Object_Ownership_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Object_Ownership_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Object_Ownership_Stream_Cursor_Value_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  is_admin?: InputMaybe<Scalars['Boolean']['input']>;
  marked_as_deleted?: InputMaybe<Scalars['timestamp']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** column ordering options */
export enum Order_By {
  /** in ascending order, nulls last */
  Asc = 'asc',
  /** in ascending order, nulls first */
  AscNullsFirst = 'asc_nulls_first',
  /** in ascending order, nulls last */
  AscNullsLast = 'asc_nulls_last',
  /** in descending order, nulls first */
  Desc = 'desc',
  /** in descending order, nulls first */
  DescNullsFirst = 'desc_nulls_first',
  /** in descending order, nulls last */
  DescNullsLast = 'desc_nulls_last'
}

/** columns and relationships of "organizations" */
export type Organizations = {
  __typename?: 'organizations';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "organizations" */
export type Organizations_Aggregate = {
  __typename?: 'organizations_aggregate';
  aggregate?: Maybe<Organizations_Aggregate_Fields>;
  nodes: Array<Organizations>;
};

/** aggregate fields of "organizations" */
export type Organizations_Aggregate_Fields = {
  __typename?: 'organizations_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Organizations_Max_Fields>;
  min?: Maybe<Organizations_Min_Fields>;
};


/** aggregate fields of "organizations" */
export type Organizations_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Organizations_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "organizations". All fields are combined with a logical 'AND'. */
export type Organizations_Bool_Exp = {
  _and?: InputMaybe<Array<Organizations_Bool_Exp>>;
  _not?: InputMaybe<Organizations_Bool_Exp>;
  _or?: InputMaybe<Array<Organizations_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Organizations_Max_Fields = {
  __typename?: 'organizations_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Organizations_Min_Fields = {
  __typename?: 'organizations_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** Ordering options when selecting data from "organizations". */
export type Organizations_Order_By = {
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** select columns of table "organizations" */
export enum Organizations_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  Name = 'name',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** Streaming cursor of the table "organizations" */
export type Organizations_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Organizations_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Organizations_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

export type Query_Root = {
  __typename?: 'query_root';
  /** fetch data from the table: "api_keys" */
  api_keys: Array<Api_Keys>;
  /** fetch aggregated fields from the table: "api_keys" */
  api_keys_aggregate: Api_Keys_Aggregate;
  /** fetch data from the table: "api_keys" using primary key columns */
  api_keys_by_pk?: Maybe<Api_Keys>;
  /** fetch data from the table: "interactions" */
  interactions: Array<Interactions>;
  /** fetch aggregated fields from the table: "interactions" */
  interactions_aggregate: Interactions_Aggregate;
  /** fetch data from the table: "metadata" */
  metadata: Array<Metadata>;
  /** fetch aggregated fields from the table: "metadata" */
  metadata_aggregate: Metadata_Aggregate;
  /** fetch data from the table: "metadata" using primary key columns */
  metadata_by_pk?: Maybe<Metadata>;
  /** An array relationship */
  nodes: Array<Nodes>;
  /** An aggregate relationship */
  nodes_aggregate: Nodes_Aggregate;
  /** fetch data from the table: "nodes" using primary key columns */
  nodes_by_pk?: Maybe<Nodes>;
  /** An array relationship */
  object_ownership: Array<Object_Ownership>;
  /** An aggregate relationship */
  object_ownership_aggregate: Object_Ownership_Aggregate;
  /** fetch data from the table: "object_ownership" using primary key columns */
  object_ownership_by_pk?: Maybe<Object_Ownership>;
  /** fetch data from the table: "organizations" */
  organizations: Array<Organizations>;
  /** fetch aggregated fields from the table: "organizations" */
  organizations_aggregate: Organizations_Aggregate;
  /** fetch data from the table: "organizations" using primary key columns */
  organizations_by_pk?: Maybe<Organizations>;
  /** fetch data from the table: "subscriptions" */
  subscriptions: Array<Subscriptions>;
  /** fetch aggregated fields from the table: "subscriptions" */
  subscriptions_aggregate: Subscriptions_Aggregate;
  /** fetch data from the table: "subscriptions" using primary key columns */
  subscriptions_by_pk?: Maybe<Subscriptions>;
  /** fetch data from the table: "transaction_results" */
  transaction_results: Array<Transaction_Results>;
  /** fetch aggregated fields from the table: "transaction_results" */
  transaction_results_aggregate: Transaction_Results_Aggregate;
  /** fetch data from the table: "transaction_results" using primary key columns */
  transaction_results_by_pk?: Maybe<Transaction_Results>;
  /** fetch data from the table: "users" */
  users: Array<Users>;
  /** fetch aggregated fields from the table: "users" */
  users_aggregate: Users_Aggregate;
  /** fetch data from the table: "users" using primary key columns */
  users_by_pk?: Maybe<Users>;
  /** fetch data from the table: "users_organizations" */
  users_organizations: Array<Users_Organizations>;
  /** fetch aggregated fields from the table: "users_organizations" */
  users_organizations_aggregate: Users_Organizations_Aggregate;
};


export type Query_RootApi_KeysArgs = {
  distinct_on?: InputMaybe<Array<Api_Keys_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Api_Keys_Order_By>>;
  where?: InputMaybe<Api_Keys_Bool_Exp>;
};


export type Query_RootApi_Keys_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Api_Keys_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Api_Keys_Order_By>>;
  where?: InputMaybe<Api_Keys_Bool_Exp>;
};


export type Query_RootApi_Keys_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootInteractionsArgs = {
  distinct_on?: InputMaybe<Array<Interactions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Interactions_Order_By>>;
  where?: InputMaybe<Interactions_Bool_Exp>;
};


export type Query_RootInteractions_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Interactions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Interactions_Order_By>>;
  where?: InputMaybe<Interactions_Bool_Exp>;
};


export type Query_RootMetadataArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


export type Query_RootMetadata_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


export type Query_RootMetadata_By_PkArgs = {
  head_cid: Scalars['String']['input'];
  root_cid: Scalars['String']['input'];
};


export type Query_RootNodesArgs = {
  distinct_on?: InputMaybe<Array<Nodes_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Nodes_Order_By>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


export type Query_RootNodes_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Nodes_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Nodes_Order_By>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


export type Query_RootNodes_By_PkArgs = {
  cid: Scalars['String']['input'];
};


export type Query_RootObject_OwnershipArgs = {
  distinct_on?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Object_Ownership_Order_By>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};


export type Query_RootObject_Ownership_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Object_Ownership_Order_By>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};


export type Query_RootObject_Ownership_By_PkArgs = {
  cid: Scalars['String']['input'];
  oauth_provider: Scalars['String']['input'];
  oauth_user_id: Scalars['String']['input'];
};


export type Query_RootOrganizationsArgs = {
  distinct_on?: InputMaybe<Array<Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Organizations_Order_By>>;
  where?: InputMaybe<Organizations_Bool_Exp>;
};


export type Query_RootOrganizations_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Organizations_Order_By>>;
  where?: InputMaybe<Organizations_Bool_Exp>;
};


export type Query_RootOrganizations_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootSubscriptionsArgs = {
  distinct_on?: InputMaybe<Array<Subscriptions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Subscriptions_Order_By>>;
  where?: InputMaybe<Subscriptions_Bool_Exp>;
};


export type Query_RootSubscriptions_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Subscriptions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Subscriptions_Order_By>>;
  where?: InputMaybe<Subscriptions_Bool_Exp>;
};


export type Query_RootSubscriptions_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Query_RootTransaction_ResultsArgs = {
  distinct_on?: InputMaybe<Array<Transaction_Results_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Transaction_Results_Order_By>>;
  where?: InputMaybe<Transaction_Results_Bool_Exp>;
};


export type Query_RootTransaction_Results_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Transaction_Results_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Transaction_Results_Order_By>>;
  where?: InputMaybe<Transaction_Results_Bool_Exp>;
};


export type Query_RootTransaction_Results_By_PkArgs = {
  cid: Scalars['String']['input'];
};


export type Query_RootUsersArgs = {
  distinct_on?: InputMaybe<Array<Users_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Order_By>>;
  where?: InputMaybe<Users_Bool_Exp>;
};


export type Query_RootUsers_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Users_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Order_By>>;
  where?: InputMaybe<Users_Bool_Exp>;
};


export type Query_RootUsers_By_PkArgs = {
  oauth_provider: Scalars['String']['input'];
  oauth_user_id: Scalars['String']['input'];
};


export type Query_RootUsers_OrganizationsArgs = {
  distinct_on?: InputMaybe<Array<Users_Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Organizations_Order_By>>;
  where?: InputMaybe<Users_Organizations_Bool_Exp>;
};


export type Query_RootUsers_Organizations_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Users_Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Organizations_Order_By>>;
  where?: InputMaybe<Users_Organizations_Bool_Exp>;
};

export type Subscription_Root = {
  __typename?: 'subscription_root';
  /** fetch data from the table: "api_keys" */
  api_keys: Array<Api_Keys>;
  /** fetch aggregated fields from the table: "api_keys" */
  api_keys_aggregate: Api_Keys_Aggregate;
  /** fetch data from the table: "api_keys" using primary key columns */
  api_keys_by_pk?: Maybe<Api_Keys>;
  /** fetch data from the table in a streaming manner: "api_keys" */
  api_keys_stream: Array<Api_Keys>;
  /** fetch data from the table: "interactions" */
  interactions: Array<Interactions>;
  /** fetch aggregated fields from the table: "interactions" */
  interactions_aggregate: Interactions_Aggregate;
  /** fetch data from the table in a streaming manner: "interactions" */
  interactions_stream: Array<Interactions>;
  /** fetch data from the table: "metadata" */
  metadata: Array<Metadata>;
  /** fetch aggregated fields from the table: "metadata" */
  metadata_aggregate: Metadata_Aggregate;
  /** fetch data from the table: "metadata" using primary key columns */
  metadata_by_pk?: Maybe<Metadata>;
  /** fetch data from the table in a streaming manner: "metadata" */
  metadata_stream: Array<Metadata>;
  /** An array relationship */
  nodes: Array<Nodes>;
  /** An aggregate relationship */
  nodes_aggregate: Nodes_Aggregate;
  /** fetch data from the table: "nodes" using primary key columns */
  nodes_by_pk?: Maybe<Nodes>;
  /** fetch data from the table in a streaming manner: "nodes" */
  nodes_stream: Array<Nodes>;
  /** An array relationship */
  object_ownership: Array<Object_Ownership>;
  /** An aggregate relationship */
  object_ownership_aggregate: Object_Ownership_Aggregate;
  /** fetch data from the table: "object_ownership" using primary key columns */
  object_ownership_by_pk?: Maybe<Object_Ownership>;
  /** fetch data from the table in a streaming manner: "object_ownership" */
  object_ownership_stream: Array<Object_Ownership>;
  /** fetch data from the table: "organizations" */
  organizations: Array<Organizations>;
  /** fetch aggregated fields from the table: "organizations" */
  organizations_aggregate: Organizations_Aggregate;
  /** fetch data from the table: "organizations" using primary key columns */
  organizations_by_pk?: Maybe<Organizations>;
  /** fetch data from the table in a streaming manner: "organizations" */
  organizations_stream: Array<Organizations>;
  /** fetch data from the table: "subscriptions" */
  subscriptions: Array<Subscriptions>;
  /** fetch aggregated fields from the table: "subscriptions" */
  subscriptions_aggregate: Subscriptions_Aggregate;
  /** fetch data from the table: "subscriptions" using primary key columns */
  subscriptions_by_pk?: Maybe<Subscriptions>;
  /** fetch data from the table in a streaming manner: "subscriptions" */
  subscriptions_stream: Array<Subscriptions>;
  /** fetch data from the table: "transaction_results" */
  transaction_results: Array<Transaction_Results>;
  /** fetch aggregated fields from the table: "transaction_results" */
  transaction_results_aggregate: Transaction_Results_Aggregate;
  /** fetch data from the table: "transaction_results" using primary key columns */
  transaction_results_by_pk?: Maybe<Transaction_Results>;
  /** fetch data from the table in a streaming manner: "transaction_results" */
  transaction_results_stream: Array<Transaction_Results>;
  /** fetch data from the table: "users" */
  users: Array<Users>;
  /** fetch aggregated fields from the table: "users" */
  users_aggregate: Users_Aggregate;
  /** fetch data from the table: "users" using primary key columns */
  users_by_pk?: Maybe<Users>;
  /** fetch data from the table: "users_organizations" */
  users_organizations: Array<Users_Organizations>;
  /** fetch aggregated fields from the table: "users_organizations" */
  users_organizations_aggregate: Users_Organizations_Aggregate;
  /** fetch data from the table in a streaming manner: "users_organizations" */
  users_organizations_stream: Array<Users_Organizations>;
  /** fetch data from the table in a streaming manner: "users" */
  users_stream: Array<Users>;
};


export type Subscription_RootApi_KeysArgs = {
  distinct_on?: InputMaybe<Array<Api_Keys_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Api_Keys_Order_By>>;
  where?: InputMaybe<Api_Keys_Bool_Exp>;
};


export type Subscription_RootApi_Keys_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Api_Keys_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Api_Keys_Order_By>>;
  where?: InputMaybe<Api_Keys_Bool_Exp>;
};


export type Subscription_RootApi_Keys_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootApi_Keys_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Api_Keys_Stream_Cursor_Input>>;
  where?: InputMaybe<Api_Keys_Bool_Exp>;
};


export type Subscription_RootInteractionsArgs = {
  distinct_on?: InputMaybe<Array<Interactions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Interactions_Order_By>>;
  where?: InputMaybe<Interactions_Bool_Exp>;
};


export type Subscription_RootInteractions_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Interactions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Interactions_Order_By>>;
  where?: InputMaybe<Interactions_Bool_Exp>;
};


export type Subscription_RootInteractions_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Interactions_Stream_Cursor_Input>>;
  where?: InputMaybe<Interactions_Bool_Exp>;
};


export type Subscription_RootMetadataArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


export type Subscription_RootMetadata_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Order_By>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


export type Subscription_RootMetadata_By_PkArgs = {
  head_cid: Scalars['String']['input'];
  root_cid: Scalars['String']['input'];
};


export type Subscription_RootMetadata_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Metadata_Stream_Cursor_Input>>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};


export type Subscription_RootNodesArgs = {
  distinct_on?: InputMaybe<Array<Nodes_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Nodes_Order_By>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


export type Subscription_RootNodes_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Nodes_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Nodes_Order_By>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


export type Subscription_RootNodes_By_PkArgs = {
  cid: Scalars['String']['input'];
};


export type Subscription_RootNodes_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Nodes_Stream_Cursor_Input>>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};


export type Subscription_RootObject_OwnershipArgs = {
  distinct_on?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Object_Ownership_Order_By>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};


export type Subscription_RootObject_Ownership_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Object_Ownership_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Object_Ownership_Order_By>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};


export type Subscription_RootObject_Ownership_By_PkArgs = {
  cid: Scalars['String']['input'];
  oauth_provider: Scalars['String']['input'];
  oauth_user_id: Scalars['String']['input'];
};


export type Subscription_RootObject_Ownership_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Object_Ownership_Stream_Cursor_Input>>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
};


export type Subscription_RootOrganizationsArgs = {
  distinct_on?: InputMaybe<Array<Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Organizations_Order_By>>;
  where?: InputMaybe<Organizations_Bool_Exp>;
};


export type Subscription_RootOrganizations_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Organizations_Order_By>>;
  where?: InputMaybe<Organizations_Bool_Exp>;
};


export type Subscription_RootOrganizations_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootOrganizations_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Organizations_Stream_Cursor_Input>>;
  where?: InputMaybe<Organizations_Bool_Exp>;
};


export type Subscription_RootSubscriptionsArgs = {
  distinct_on?: InputMaybe<Array<Subscriptions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Subscriptions_Order_By>>;
  where?: InputMaybe<Subscriptions_Bool_Exp>;
};


export type Subscription_RootSubscriptions_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Subscriptions_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Subscriptions_Order_By>>;
  where?: InputMaybe<Subscriptions_Bool_Exp>;
};


export type Subscription_RootSubscriptions_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootSubscriptions_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Subscriptions_Stream_Cursor_Input>>;
  where?: InputMaybe<Subscriptions_Bool_Exp>;
};


export type Subscription_RootTransaction_ResultsArgs = {
  distinct_on?: InputMaybe<Array<Transaction_Results_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Transaction_Results_Order_By>>;
  where?: InputMaybe<Transaction_Results_Bool_Exp>;
};


export type Subscription_RootTransaction_Results_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Transaction_Results_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Transaction_Results_Order_By>>;
  where?: InputMaybe<Transaction_Results_Bool_Exp>;
};


export type Subscription_RootTransaction_Results_By_PkArgs = {
  cid: Scalars['String']['input'];
};


export type Subscription_RootTransaction_Results_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Transaction_Results_Stream_Cursor_Input>>;
  where?: InputMaybe<Transaction_Results_Bool_Exp>;
};


export type Subscription_RootUsersArgs = {
  distinct_on?: InputMaybe<Array<Users_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Order_By>>;
  where?: InputMaybe<Users_Bool_Exp>;
};


export type Subscription_RootUsers_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Users_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Order_By>>;
  where?: InputMaybe<Users_Bool_Exp>;
};


export type Subscription_RootUsers_By_PkArgs = {
  oauth_provider: Scalars['String']['input'];
  oauth_user_id: Scalars['String']['input'];
};


export type Subscription_RootUsers_OrganizationsArgs = {
  distinct_on?: InputMaybe<Array<Users_Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Organizations_Order_By>>;
  where?: InputMaybe<Users_Organizations_Bool_Exp>;
};


export type Subscription_RootUsers_Organizations_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Users_Organizations_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Users_Organizations_Order_By>>;
  where?: InputMaybe<Users_Organizations_Bool_Exp>;
};


export type Subscription_RootUsers_Organizations_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Users_Organizations_Stream_Cursor_Input>>;
  where?: InputMaybe<Users_Organizations_Bool_Exp>;
};


export type Subscription_RootUsers_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Users_Stream_Cursor_Input>>;
  where?: InputMaybe<Users_Bool_Exp>;
};

/** columns and relationships of "subscriptions" */
export type Subscriptions = {
  __typename?: 'subscriptions';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  download_limit: Scalars['bigint']['output'];
  granularity: Scalars['String']['output'];
  id: Scalars['String']['output'];
  organization_id: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
  upload_limit: Scalars['bigint']['output'];
};

/** aggregated selection of "subscriptions" */
export type Subscriptions_Aggregate = {
  __typename?: 'subscriptions_aggregate';
  aggregate?: Maybe<Subscriptions_Aggregate_Fields>;
  nodes: Array<Subscriptions>;
};

/** aggregate fields of "subscriptions" */
export type Subscriptions_Aggregate_Fields = {
  __typename?: 'subscriptions_aggregate_fields';
  avg?: Maybe<Subscriptions_Avg_Fields>;
  count: Scalars['Int']['output'];
  max?: Maybe<Subscriptions_Max_Fields>;
  min?: Maybe<Subscriptions_Min_Fields>;
  stddev?: Maybe<Subscriptions_Stddev_Fields>;
  stddev_pop?: Maybe<Subscriptions_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Subscriptions_Stddev_Samp_Fields>;
  sum?: Maybe<Subscriptions_Sum_Fields>;
  var_pop?: Maybe<Subscriptions_Var_Pop_Fields>;
  var_samp?: Maybe<Subscriptions_Var_Samp_Fields>;
  variance?: Maybe<Subscriptions_Variance_Fields>;
};


/** aggregate fields of "subscriptions" */
export type Subscriptions_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Subscriptions_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** aggregate avg on columns */
export type Subscriptions_Avg_Fields = {
  __typename?: 'subscriptions_avg_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** Boolean expression to filter rows from the table "subscriptions". All fields are combined with a logical 'AND'. */
export type Subscriptions_Bool_Exp = {
  _and?: InputMaybe<Array<Subscriptions_Bool_Exp>>;
  _not?: InputMaybe<Subscriptions_Bool_Exp>;
  _or?: InputMaybe<Array<Subscriptions_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  download_limit?: InputMaybe<Bigint_Comparison_Exp>;
  granularity?: InputMaybe<String_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  organization_id?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
  upload_limit?: InputMaybe<Bigint_Comparison_Exp>;
};

/** aggregate max on columns */
export type Subscriptions_Max_Fields = {
  __typename?: 'subscriptions_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  download_limit?: Maybe<Scalars['bigint']['output']>;
  granularity?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  organization_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
  upload_limit?: Maybe<Scalars['bigint']['output']>;
};

/** aggregate min on columns */
export type Subscriptions_Min_Fields = {
  __typename?: 'subscriptions_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  download_limit?: Maybe<Scalars['bigint']['output']>;
  granularity?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  organization_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
  upload_limit?: Maybe<Scalars['bigint']['output']>;
};

/** Ordering options when selecting data from "subscriptions". */
export type Subscriptions_Order_By = {
  created_at?: InputMaybe<Order_By>;
  download_limit?: InputMaybe<Order_By>;
  granularity?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  organization_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
  upload_limit?: InputMaybe<Order_By>;
};

/** select columns of table "subscriptions" */
export enum Subscriptions_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  DownloadLimit = 'download_limit',
  /** column name */
  Granularity = 'granularity',
  /** column name */
  Id = 'id',
  /** column name */
  OrganizationId = 'organization_id',
  /** column name */
  UpdatedAt = 'updated_at',
  /** column name */
  UploadLimit = 'upload_limit'
}

/** aggregate stddev on columns */
export type Subscriptions_Stddev_Fields = {
  __typename?: 'subscriptions_stddev_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** aggregate stddev_pop on columns */
export type Subscriptions_Stddev_Pop_Fields = {
  __typename?: 'subscriptions_stddev_pop_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** aggregate stddev_samp on columns */
export type Subscriptions_Stddev_Samp_Fields = {
  __typename?: 'subscriptions_stddev_samp_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** Streaming cursor of the table "subscriptions" */
export type Subscriptions_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Subscriptions_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Subscriptions_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  download_limit?: InputMaybe<Scalars['bigint']['input']>;
  granularity?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  organization_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
  upload_limit?: InputMaybe<Scalars['bigint']['input']>;
};

/** aggregate sum on columns */
export type Subscriptions_Sum_Fields = {
  __typename?: 'subscriptions_sum_fields';
  download_limit?: Maybe<Scalars['bigint']['output']>;
  upload_limit?: Maybe<Scalars['bigint']['output']>;
};

/** aggregate var_pop on columns */
export type Subscriptions_Var_Pop_Fields = {
  __typename?: 'subscriptions_var_pop_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** aggregate var_samp on columns */
export type Subscriptions_Var_Samp_Fields = {
  __typename?: 'subscriptions_var_samp_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** aggregate variance on columns */
export type Subscriptions_Variance_Fields = {
  __typename?: 'subscriptions_variance_fields';
  download_limit?: Maybe<Scalars['Float']['output']>;
  upload_limit?: Maybe<Scalars['Float']['output']>;
};

/** Boolean expression to compare columns of type "timestamp". All fields are combined with logical 'AND'. */
export type Timestamp_Comparison_Exp = {
  _eq?: InputMaybe<Scalars['timestamp']['input']>;
  _gt?: InputMaybe<Scalars['timestamp']['input']>;
  _gte?: InputMaybe<Scalars['timestamp']['input']>;
  _in?: InputMaybe<Array<Scalars['timestamp']['input']>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Scalars['timestamp']['input']>;
  _lte?: InputMaybe<Scalars['timestamp']['input']>;
  _neq?: InputMaybe<Scalars['timestamp']['input']>;
  _nin?: InputMaybe<Array<Scalars['timestamp']['input']>>;
};

/** columns and relationships of "transaction_results" */
export type Transaction_Results = {
  __typename?: 'transaction_results';
  cid: Scalars['String']['output'];
  created_at?: Maybe<Scalars['timestamp']['output']>;
  /** An object relationship */
  node?: Maybe<Nodes>;
  transaction_result?: Maybe<Scalars['jsonb']['output']>;
  updated_at: Scalars['timestamp']['output'];
};


/** columns and relationships of "transaction_results" */
export type Transaction_ResultsTransaction_ResultArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};

/** aggregated selection of "transaction_results" */
export type Transaction_Results_Aggregate = {
  __typename?: 'transaction_results_aggregate';
  aggregate?: Maybe<Transaction_Results_Aggregate_Fields>;
  nodes: Array<Transaction_Results>;
};

/** aggregate fields of "transaction_results" */
export type Transaction_Results_Aggregate_Fields = {
  __typename?: 'transaction_results_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Transaction_Results_Max_Fields>;
  min?: Maybe<Transaction_Results_Min_Fields>;
};


/** aggregate fields of "transaction_results" */
export type Transaction_Results_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Transaction_Results_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "transaction_results". All fields are combined with a logical 'AND'. */
export type Transaction_Results_Bool_Exp = {
  _and?: InputMaybe<Array<Transaction_Results_Bool_Exp>>;
  _not?: InputMaybe<Transaction_Results_Bool_Exp>;
  _or?: InputMaybe<Array<Transaction_Results_Bool_Exp>>;
  cid?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  node?: InputMaybe<Nodes_Bool_Exp>;
  transaction_result?: InputMaybe<Jsonb_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Transaction_Results_Max_Fields = {
  __typename?: 'transaction_results_max_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Transaction_Results_Min_Fields = {
  __typename?: 'transaction_results_min_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** Ordering options when selecting data from "transaction_results". */
export type Transaction_Results_Order_By = {
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  node?: InputMaybe<Nodes_Order_By>;
  transaction_result?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** select columns of table "transaction_results" */
export enum Transaction_Results_Select_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  TransactionResult = 'transaction_result',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** Streaming cursor of the table "transaction_results" */
export type Transaction_Results_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Transaction_Results_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Transaction_Results_Stream_Cursor_Value_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  transaction_result?: InputMaybe<Scalars['jsonb']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** columns and relationships of "users" */
export type Users = {
  __typename?: 'users';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider: Scalars['String']['output'];
  oauth_user_id: Scalars['String']['output'];
  public_id?: Maybe<Scalars['String']['output']>;
  role: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "users" */
export type Users_Aggregate = {
  __typename?: 'users_aggregate';
  aggregate?: Maybe<Users_Aggregate_Fields>;
  nodes: Array<Users>;
};

/** aggregate fields of "users" */
export type Users_Aggregate_Fields = {
  __typename?: 'users_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Users_Max_Fields>;
  min?: Maybe<Users_Min_Fields>;
};


/** aggregate fields of "users" */
export type Users_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Users_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "users". All fields are combined with a logical 'AND'. */
export type Users_Bool_Exp = {
  _and?: InputMaybe<Array<Users_Bool_Exp>>;
  _not?: InputMaybe<Users_Bool_Exp>;
  _or?: InputMaybe<Array<Users_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  oauth_provider?: InputMaybe<String_Comparison_Exp>;
  oauth_user_id?: InputMaybe<String_Comparison_Exp>;
  public_id?: InputMaybe<String_Comparison_Exp>;
  role?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Users_Max_Fields = {
  __typename?: 'users_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  public_id?: Maybe<Scalars['String']['output']>;
  role?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Users_Min_Fields = {
  __typename?: 'users_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  public_id?: Maybe<Scalars['String']['output']>;
  role?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** Ordering options when selecting data from "users". */
export type Users_Order_By = {
  created_at?: InputMaybe<Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  public_id?: InputMaybe<Order_By>;
  role?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** columns and relationships of "users_organizations" */
export type Users_Organizations = {
  __typename?: 'users_organizations';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider: Scalars['String']['output'];
  oauth_user_id: Scalars['String']['output'];
  organization_id: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "users_organizations" */
export type Users_Organizations_Aggregate = {
  __typename?: 'users_organizations_aggregate';
  aggregate?: Maybe<Users_Organizations_Aggregate_Fields>;
  nodes: Array<Users_Organizations>;
};

/** aggregate fields of "users_organizations" */
export type Users_Organizations_Aggregate_Fields = {
  __typename?: 'users_organizations_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Users_Organizations_Max_Fields>;
  min?: Maybe<Users_Organizations_Min_Fields>;
};


/** aggregate fields of "users_organizations" */
export type Users_Organizations_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Users_Organizations_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "users_organizations". All fields are combined with a logical 'AND'. */
export type Users_Organizations_Bool_Exp = {
  _and?: InputMaybe<Array<Users_Organizations_Bool_Exp>>;
  _not?: InputMaybe<Users_Organizations_Bool_Exp>;
  _or?: InputMaybe<Array<Users_Organizations_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  oauth_provider?: InputMaybe<String_Comparison_Exp>;
  oauth_user_id?: InputMaybe<String_Comparison_Exp>;
  organization_id?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** aggregate max on columns */
export type Users_Organizations_Max_Fields = {
  __typename?: 'users_organizations_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  organization_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Users_Organizations_Min_Fields = {
  __typename?: 'users_organizations_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  organization_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** Ordering options when selecting data from "users_organizations". */
export type Users_Organizations_Order_By = {
  created_at?: InputMaybe<Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  organization_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** select columns of table "users_organizations" */
export enum Users_Organizations_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  OauthProvider = 'oauth_provider',
  /** column name */
  OauthUserId = 'oauth_user_id',
  /** column name */
  OrganizationId = 'organization_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** Streaming cursor of the table "users_organizations" */
export type Users_Organizations_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Users_Organizations_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Users_Organizations_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  organization_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** select columns of table "users" */
export enum Users_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  OauthProvider = 'oauth_provider',
  /** column name */
  OauthUserId = 'oauth_user_id',
  /** column name */
  PublicId = 'public_id',
  /** column name */
  Role = 'role',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** Streaming cursor of the table "users" */
export type Users_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Users_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Users_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  public_id?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

export type GetSharedFilesQueryVariables = Exact<{
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
}>;


export type GetSharedFilesQuery = { __typename?: 'query_root', metadata: Array<{ __typename?: 'metadata', root_metadata?: { __typename?: 'metadata', cid: string, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, maximumBlockDepth: Array<{ __typename?: 'nodes', transaction_result?: { __typename?: 'transaction_results', blockNumber?: any | null } | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', transaction_result?: { __typename?: 'transaction_results', blockNumber?: any | null } | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', is_admin?: boolean | null, user?: { __typename?: 'users', public_id?: string | null } | null }> } | null }>, metadata_aggregate: { __typename?: 'metadata_aggregate', aggregate?: { __typename?: 'metadata_aggregate_fields', count: number } | null } };

export type GetTrashedFilesQueryVariables = Exact<{
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
}>;


export type GetTrashedFilesQuery = { __typename?: 'query_root', metadata: Array<{ __typename?: 'metadata', root_metadata?: { __typename?: 'metadata', cid: string, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, maximumBlockDepth: Array<{ __typename?: 'nodes', transaction_result?: { __typename?: 'transaction_results', blockNumber?: any | null } | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', transaction_result?: { __typename?: 'transaction_results', blockNumber?: any | null } | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', is_admin?: boolean | null, user?: { __typename?: 'users', public_id?: string | null } | null }> } | null }>, metadata_aggregate: { __typename?: 'metadata_aggregate', aggregate?: { __typename?: 'metadata_aggregate_fields', count: number } | null } };

export type GetMyFilesQueryVariables = Exact<{
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
}>;


export type GetMyFilesQuery = { __typename?: 'query_root', metadata: Array<{ __typename?: 'metadata', root_metadata?: { __typename?: 'metadata', cid: string, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, maximumBlockDepth: Array<{ __typename?: 'nodes', transaction_result?: { __typename?: 'transaction_results', blockNumber?: any | null } | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', transaction_result?: { __typename?: 'transaction_results', blockNumber?: any | null } | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', is_admin?: boolean | null, user?: { __typename?: 'users', public_id?: string | null } | null }> } | null }>, metadata_aggregate: { __typename?: 'metadata_aggregate', aggregate?: { __typename?: 'metadata_aggregate_fields', count: number } | null } };


export const GetSharedFilesDocument = gql`
    query GetSharedFiles($oauthUserId: String!, $oauthProvider: String!, $limit: Int!, $offset: Int!) {
  metadata(
    distinct_on: root_cid
    where: {root_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: true}, is_admin: {_eq: false}}}}}
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
        order_by: {transaction_result: {created_at: desc_nulls_first}}
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      minimumBlockDepth: nodes(
        order_by: {transaction_result: {created_at: asc}}
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      publishedNodes: nodes_aggregate(
        where: {transaction_result: {transaction_result: {_is_null: false}}}
      ) {
        aggregate {
          count
        }
      }
      archivedNodes: nodes_aggregate(where: {piece_offset: {_is_null: false}}) {
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
  metadata_aggregate(
    distinct_on: root_cid
    where: {root_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, is_admin: {_eq: true}}}}}
  ) {
    aggregate {
      count
    }
  }
}
    `;

/**
 * __useGetSharedFilesQuery__
 *
 * To run a query within a React component, call `useGetSharedFilesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSharedFilesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSharedFilesQuery({
 *   variables: {
 *      oauthUserId: // value for 'oauthUserId'
 *      oauthProvider: // value for 'oauthProvider'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useGetSharedFilesQuery(baseOptions: Apollo.QueryHookOptions<GetSharedFilesQuery, GetSharedFilesQueryVariables> & ({ variables: GetSharedFilesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetSharedFilesQuery, GetSharedFilesQueryVariables>(GetSharedFilesDocument, options);
      }
export function useGetSharedFilesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetSharedFilesQuery, GetSharedFilesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetSharedFilesQuery, GetSharedFilesQueryVariables>(GetSharedFilesDocument, options);
        }
export function useGetSharedFilesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GetSharedFilesQuery, GetSharedFilesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<GetSharedFilesQuery, GetSharedFilesQueryVariables>(GetSharedFilesDocument, options);
        }
export type GetSharedFilesQueryHookResult = ReturnType<typeof useGetSharedFilesQuery>;
export type GetSharedFilesLazyQueryHookResult = ReturnType<typeof useGetSharedFilesLazyQuery>;
export type GetSharedFilesSuspenseQueryHookResult = ReturnType<typeof useGetSharedFilesSuspenseQuery>;
export type GetSharedFilesQueryResult = Apollo.QueryResult<GetSharedFilesQuery, GetSharedFilesQueryVariables>;
export const GetTrashedFilesDocument = gql`
    query GetTrashedFiles($oauthUserId: String!, $oauthProvider: String!, $limit: Int!, $offset: Int!) {
  metadata(
    distinct_on: root_cid
    where: {root_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: false}}}}}
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
        order_by: {transaction_result: {created_at: desc_nulls_first}}
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      minimumBlockDepth: nodes(
        order_by: {transaction_result: {created_at: asc}}
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      publishedNodes: nodes_aggregate(
        where: {transaction_result: {transaction_result: {_is_null: false}}}
      ) {
        aggregate {
          count
        }
      }
      archivedNodes: nodes_aggregate(where: {piece_offset: {_is_null: false}}) {
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
  metadata_aggregate(
    distinct_on: root_cid
    where: {root_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: false}}}}}
  ) {
    aggregate {
      count
    }
  }
}
    `;

/**
 * __useGetTrashedFilesQuery__
 *
 * To run a query within a React component, call `useGetTrashedFilesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetTrashedFilesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetTrashedFilesQuery({
 *   variables: {
 *      oauthUserId: // value for 'oauthUserId'
 *      oauthProvider: // value for 'oauthProvider'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useGetTrashedFilesQuery(baseOptions: Apollo.QueryHookOptions<GetTrashedFilesQuery, GetTrashedFilesQueryVariables> & ({ variables: GetTrashedFilesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetTrashedFilesQuery, GetTrashedFilesQueryVariables>(GetTrashedFilesDocument, options);
      }
export function useGetTrashedFilesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetTrashedFilesQuery, GetTrashedFilesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetTrashedFilesQuery, GetTrashedFilesQueryVariables>(GetTrashedFilesDocument, options);
        }
export function useGetTrashedFilesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GetTrashedFilesQuery, GetTrashedFilesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<GetTrashedFilesQuery, GetTrashedFilesQueryVariables>(GetTrashedFilesDocument, options);
        }
export type GetTrashedFilesQueryHookResult = ReturnType<typeof useGetTrashedFilesQuery>;
export type GetTrashedFilesLazyQueryHookResult = ReturnType<typeof useGetTrashedFilesLazyQuery>;
export type GetTrashedFilesSuspenseQueryHookResult = ReturnType<typeof useGetTrashedFilesSuspenseQuery>;
export type GetTrashedFilesQueryResult = Apollo.QueryResult<GetTrashedFilesQuery, GetTrashedFilesQueryVariables>;
export const GetMyFilesDocument = gql`
    query GetMyFiles($oauthUserId: String!, $oauthProvider: String!, $limit: Int!, $offset: Int!) {
  metadata(
    distinct_on: root_cid
    where: {root_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, is_admin: {_eq: true}}}}}
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
        order_by: {transaction_result: {created_at: desc_nulls_first}}
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      minimumBlockDepth: nodes(
        order_by: {transaction_result: {created_at: asc}}
        limit: 1
      ) {
        transaction_result {
          blockNumber: transaction_result(path: "blockNumber")
        }
      }
      publishedNodes: nodes_aggregate(
        where: {transaction_result: {transaction_result: {_is_null: false}}}
      ) {
        aggregate {
          count
        }
      }
      archivedNodes: nodes_aggregate(where: {piece_offset: {_is_null: false}}) {
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
  metadata_aggregate(
    distinct_on: root_cid
    where: {root_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, is_admin: {_eq: true}}}}}
  ) {
    aggregate {
      count
    }
  }
}
    `;

/**
 * __useGetMyFilesQuery__
 *
 * To run a query within a React component, call `useGetMyFilesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetMyFilesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetMyFilesQuery({
 *   variables: {
 *      oauthUserId: // value for 'oauthUserId'
 *      oauthProvider: // value for 'oauthProvider'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useGetMyFilesQuery(baseOptions: Apollo.QueryHookOptions<GetMyFilesQuery, GetMyFilesQueryVariables> & ({ variables: GetMyFilesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetMyFilesQuery, GetMyFilesQueryVariables>(GetMyFilesDocument, options);
      }
export function useGetMyFilesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetMyFilesQuery, GetMyFilesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetMyFilesQuery, GetMyFilesQueryVariables>(GetMyFilesDocument, options);
        }
export function useGetMyFilesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GetMyFilesQuery, GetMyFilesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<GetMyFilesQuery, GetMyFilesQueryVariables>(GetMyFilesDocument, options);
        }
export type GetMyFilesQueryHookResult = ReturnType<typeof useGetMyFilesQuery>;
export type GetMyFilesLazyQueryHookResult = ReturnType<typeof useGetMyFilesLazyQuery>;
export type GetMyFilesSuspenseQueryHookResult = ReturnType<typeof useGetMyFilesSuspenseQuery>;
export type GetMyFilesQueryResult = Apollo.QueryResult<GetMyFilesQuery, GetMyFilesQueryVariables>;