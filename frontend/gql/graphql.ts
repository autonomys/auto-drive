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
export type String_Array_Comparison_Exp = {
  /** is the array contained in the given array value */
  _contained_in?: InputMaybe<Array<Scalars['String']['input']>>;
  /** does the array contain the given value */
  _contains?: InputMaybe<Array<Scalars['String']['input']>>;
  _eq?: InputMaybe<Array<Scalars['String']['input']>>;
  _gt?: InputMaybe<Array<Scalars['String']['input']>>;
  _gte?: InputMaybe<Array<Scalars['String']['input']>>;
  _in?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
  _is_null?: InputMaybe<Scalars['Boolean']['input']>;
  _lt?: InputMaybe<Array<Scalars['String']['input']>>;
  _lte?: InputMaybe<Array<Scalars['String']['input']>>;
  _neq?: InputMaybe<Array<Scalars['String']['input']>>;
  _nin?: InputMaybe<Array<Array<Scalars['String']['input']>>>;
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

/** columns and relationships of "async_downloads" */
export type Async_Downloads = {
  __typename?: 'async_downloads';
  cid: Scalars['String']['output'];
  created_at: Scalars['timestamp']['output'];
  downloaded_bytes?: Maybe<Scalars['bigint']['output']>;
  error_message?: Maybe<Scalars['String']['output']>;
  file_size?: Maybe<Scalars['bigint']['output']>;
  id: Scalars['String']['output'];
  oauth_provider: Scalars['String']['output'];
  oauth_user_id: Scalars['String']['output'];
  status: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "async_downloads" */
export type Async_Downloads_Aggregate = {
  __typename?: 'async_downloads_aggregate';
  aggregate?: Maybe<Async_Downloads_Aggregate_Fields>;
  nodes: Array<Async_Downloads>;
};

/** aggregate fields of "async_downloads" */
export type Async_Downloads_Aggregate_Fields = {
  __typename?: 'async_downloads_aggregate_fields';
  avg?: Maybe<Async_Downloads_Avg_Fields>;
  count: Scalars['Int']['output'];
  max?: Maybe<Async_Downloads_Max_Fields>;
  min?: Maybe<Async_Downloads_Min_Fields>;
  stddev?: Maybe<Async_Downloads_Stddev_Fields>;
  stddev_pop?: Maybe<Async_Downloads_Stddev_Pop_Fields>;
  stddev_samp?: Maybe<Async_Downloads_Stddev_Samp_Fields>;
  sum?: Maybe<Async_Downloads_Sum_Fields>;
  var_pop?: Maybe<Async_Downloads_Var_Pop_Fields>;
  var_samp?: Maybe<Async_Downloads_Var_Samp_Fields>;
  variance?: Maybe<Async_Downloads_Variance_Fields>;
};


/** aggregate fields of "async_downloads" */
export type Async_Downloads_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Async_Downloads_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** aggregate avg on columns */
export type Async_Downloads_Avg_Fields = {
  __typename?: 'async_downloads_avg_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
};

/** Boolean expression to filter rows from the table "async_downloads". All fields are combined with a logical 'AND'. */
export type Async_Downloads_Bool_Exp = {
  _and?: InputMaybe<Array<Async_Downloads_Bool_Exp>>;
  _not?: InputMaybe<Async_Downloads_Bool_Exp>;
  _or?: InputMaybe<Array<Async_Downloads_Bool_Exp>>;
  cid?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  downloaded_bytes?: InputMaybe<Bigint_Comparison_Exp>;
  error_message?: InputMaybe<String_Comparison_Exp>;
  file_size?: InputMaybe<Bigint_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  oauth_provider?: InputMaybe<String_Comparison_Exp>;
  oauth_user_id?: InputMaybe<String_Comparison_Exp>;
  status?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** unique or primary key constraints on table "async_downloads" */
export enum Async_Downloads_Constraint {
  /** unique or primary key constraint on columns "id" */
  AsyncDownloadsPkey = 'async_downloads_pkey'
}

/** input type for incrementing numeric columns in table "async_downloads" */
export type Async_Downloads_Inc_Input = {
  downloaded_bytes?: InputMaybe<Scalars['bigint']['input']>;
  file_size?: InputMaybe<Scalars['bigint']['input']>;
};

/** input type for inserting data into table "async_downloads" */
export type Async_Downloads_Insert_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  downloaded_bytes?: InputMaybe<Scalars['bigint']['input']>;
  error_message?: InputMaybe<Scalars['String']['input']>;
  file_size?: InputMaybe<Scalars['bigint']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate max on columns */
export type Async_Downloads_Max_Fields = {
  __typename?: 'async_downloads_max_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  downloaded_bytes?: Maybe<Scalars['bigint']['output']>;
  error_message?: Maybe<Scalars['String']['output']>;
  file_size?: Maybe<Scalars['bigint']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Async_Downloads_Min_Fields = {
  __typename?: 'async_downloads_min_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  downloaded_bytes?: Maybe<Scalars['bigint']['output']>;
  error_message?: Maybe<Scalars['String']['output']>;
  file_size?: Maybe<Scalars['bigint']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  oauth_provider?: Maybe<Scalars['String']['output']>;
  oauth_user_id?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** response of any mutation on the table "async_downloads" */
export type Async_Downloads_Mutation_Response = {
  __typename?: 'async_downloads_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Async_Downloads>;
};

/** on_conflict condition type for table "async_downloads" */
export type Async_Downloads_On_Conflict = {
  constraint: Async_Downloads_Constraint;
  update_columns?: Array<Async_Downloads_Update_Column>;
  where?: InputMaybe<Async_Downloads_Bool_Exp>;
};

/** Ordering options when selecting data from "async_downloads". */
export type Async_Downloads_Order_By = {
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  downloaded_bytes?: InputMaybe<Order_By>;
  error_message?: InputMaybe<Order_By>;
  file_size?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  oauth_provider?: InputMaybe<Order_By>;
  oauth_user_id?: InputMaybe<Order_By>;
  status?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: async_downloads */
export type Async_Downloads_Pk_Columns_Input = {
  id: Scalars['String']['input'];
};

/** select columns of table "async_downloads" */
export enum Async_Downloads_Select_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  DownloadedBytes = 'downloaded_bytes',
  /** column name */
  ErrorMessage = 'error_message',
  /** column name */
  FileSize = 'file_size',
  /** column name */
  Id = 'id',
  /** column name */
  OauthProvider = 'oauth_provider',
  /** column name */
  OauthUserId = 'oauth_user_id',
  /** column name */
  Status = 'status',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "async_downloads" */
export type Async_Downloads_Set_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  downloaded_bytes?: InputMaybe<Scalars['bigint']['input']>;
  error_message?: InputMaybe<Scalars['String']['input']>;
  file_size?: InputMaybe<Scalars['bigint']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate stddev on columns */
export type Async_Downloads_Stddev_Fields = {
  __typename?: 'async_downloads_stddev_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate stddev_pop on columns */
export type Async_Downloads_Stddev_Pop_Fields = {
  __typename?: 'async_downloads_stddev_pop_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate stddev_samp on columns */
export type Async_Downloads_Stddev_Samp_Fields = {
  __typename?: 'async_downloads_stddev_samp_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
};

/** Streaming cursor of the table "async_downloads" */
export type Async_Downloads_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Async_Downloads_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Async_Downloads_Stream_Cursor_Value_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  downloaded_bytes?: InputMaybe<Scalars['bigint']['input']>;
  error_message?: InputMaybe<Scalars['String']['input']>;
  file_size?: InputMaybe<Scalars['bigint']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate sum on columns */
export type Async_Downloads_Sum_Fields = {
  __typename?: 'async_downloads_sum_fields';
  downloaded_bytes?: Maybe<Scalars['bigint']['output']>;
  file_size?: Maybe<Scalars['bigint']['output']>;
};

/** update columns of table "async_downloads" */
export enum Async_Downloads_Update_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  DownloadedBytes = 'downloaded_bytes',
  /** column name */
  ErrorMessage = 'error_message',
  /** column name */
  FileSize = 'file_size',
  /** column name */
  Id = 'id',
  /** column name */
  OauthProvider = 'oauth_provider',
  /** column name */
  OauthUserId = 'oauth_user_id',
  /** column name */
  Status = 'status',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Async_Downloads_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Async_Downloads_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Async_Downloads_Set_Input>;
  /** filter the rows which have to be updated */
  where: Async_Downloads_Bool_Exp;
};

/** aggregate var_pop on columns */
export type Async_Downloads_Var_Pop_Fields = {
  __typename?: 'async_downloads_var_pop_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate var_samp on columns */
export type Async_Downloads_Var_Samp_Fields = {
  __typename?: 'async_downloads_var_samp_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
};

/** aggregate variance on columns */
export type Async_Downloads_Variance_Fields = {
  __typename?: 'async_downloads_variance_fields';
  downloaded_bytes?: Maybe<Scalars['Float']['output']>;
  file_size?: Maybe<Scalars['Float']['output']>;
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

/** input type for incrementing numeric columns in table "interactions" */
export type Interactions_Inc_Input = {
  size?: InputMaybe<Scalars['bigint']['input']>;
};

/** input type for inserting data into table "interactions" */
export type Interactions_Insert_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  size?: InputMaybe<Scalars['bigint']['input']>;
  subscription_id?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
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

/** response of any mutation on the table "interactions" */
export type Interactions_Mutation_Response = {
  __typename?: 'interactions_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Interactions>;
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

/** input type for updating data in table "interactions" */
export type Interactions_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  size?: InputMaybe<Scalars['bigint']['input']>;
  subscription_id?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

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

export type Interactions_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Interactions_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Interactions_Set_Input>;
  /** filter the rows which have to be updated */
  where: Interactions_Bool_Exp;
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
  is_archived: Scalars['Boolean']['output'];
  metadata?: Maybe<Scalars['jsonb']['output']>;
  /** An array relationship */
  metadata_list_by_root_id: Array<Metadata>;
  /** An aggregate relationship */
  metadata_list_by_root_id_aggregate: Metadata_Aggregate;
  name?: Maybe<Scalars['String']['output']>;
  /** An array relationship */
  nodes: Array<Nodes>;
  /** An aggregate relationship */
  nodes_aggregate: Nodes_Aggregate;
  /** An array relationship */
  object_ownership: Array<Object_Ownership>;
  /** An aggregate relationship */
  object_ownership_aggregate: Object_Ownership_Aggregate;
  /** An object relationship */
  published_objects?: Maybe<Published_Objects>;
  root_cid: Scalars['String']['output'];
  /** An object relationship */
  root_metadata?: Maybe<Metadata>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
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
  bool_and?: InputMaybe<Metadata_Aggregate_Bool_Exp_Bool_And>;
  bool_or?: InputMaybe<Metadata_Aggregate_Bool_Exp_Bool_Or>;
  count?: InputMaybe<Metadata_Aggregate_Bool_Exp_Count>;
};

export type Metadata_Aggregate_Bool_Exp_Bool_And = {
  arguments: Metadata_Select_Column_Metadata_Aggregate_Bool_Exp_Bool_And_Arguments_Columns;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Metadata_Bool_Exp>;
  predicate: Boolean_Comparison_Exp;
};

export type Metadata_Aggregate_Bool_Exp_Bool_Or = {
  arguments: Metadata_Select_Column_Metadata_Aggregate_Bool_Exp_Bool_Or_Arguments_Columns;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
  filter?: InputMaybe<Metadata_Bool_Exp>;
  predicate: Boolean_Comparison_Exp;
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

/** append existing jsonb value of filtered columns with new jsonb value */
export type Metadata_Append_Input = {
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
};

/** input type for inserting array relation for remote table "metadata" */
export type Metadata_Arr_Rel_Insert_Input = {
  data: Array<Metadata_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Metadata_On_Conflict>;
};

/** Boolean expression to filter rows from the table "metadata". All fields are combined with a logical 'AND'. */
export type Metadata_Bool_Exp = {
  _and?: InputMaybe<Array<Metadata_Bool_Exp>>;
  _not?: InputMaybe<Metadata_Bool_Exp>;
  _or?: InputMaybe<Array<Metadata_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  head?: InputMaybe<Nodes_Bool_Exp>;
  head_cid?: InputMaybe<String_Comparison_Exp>;
  is_archived?: InputMaybe<Boolean_Comparison_Exp>;
  metadata?: InputMaybe<Jsonb_Comparison_Exp>;
  metadata_list_by_root_id?: InputMaybe<Metadata_Bool_Exp>;
  metadata_list_by_root_id_aggregate?: InputMaybe<Metadata_Aggregate_Bool_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  nodes?: InputMaybe<Nodes_Bool_Exp>;
  nodes_aggregate?: InputMaybe<Nodes_Aggregate_Bool_Exp>;
  object_ownership?: InputMaybe<Object_Ownership_Bool_Exp>;
  object_ownership_aggregate?: InputMaybe<Object_Ownership_Aggregate_Bool_Exp>;
  published_objects?: InputMaybe<Published_Objects_Bool_Exp>;
  root_cid?: InputMaybe<String_Comparison_Exp>;
  root_metadata?: InputMaybe<Metadata_Bool_Exp>;
  tags?: InputMaybe<String_Array_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** unique or primary key constraints on table "metadata" */
export enum Metadata_Constraint {
  /** unique or primary key constraint on columns "head_cid", "root_cid" */
  MetadataPkey = 'metadata_pkey'
}

/** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
export type Metadata_Delete_At_Path_Input = {
  metadata?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
export type Metadata_Delete_Elem_Input = {
  metadata?: InputMaybe<Scalars['Int']['input']>;
};

/** delete key/value pair or string element. key/value pairs are matched based on their key value */
export type Metadata_Delete_Key_Input = {
  metadata?: InputMaybe<Scalars['String']['input']>;
};

/** input type for inserting data into table "metadata" */
export type Metadata_Insert_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  head?: InputMaybe<Nodes_Obj_Rel_Insert_Input>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  metadata_list_by_root_id?: InputMaybe<Metadata_Arr_Rel_Insert_Input>;
  name?: InputMaybe<Scalars['String']['input']>;
  nodes?: InputMaybe<Nodes_Arr_Rel_Insert_Input>;
  object_ownership?: InputMaybe<Object_Ownership_Arr_Rel_Insert_Input>;
  published_objects?: InputMaybe<Published_Objects_Obj_Rel_Insert_Input>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  root_metadata?: InputMaybe<Metadata_Obj_Rel_Insert_Input>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate max on columns */
export type Metadata_Max_Fields = {
  __typename?: 'metadata_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by max() on columns of table "metadata" */
export type Metadata_Max_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  tags?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Metadata_Min_Fields = {
  __typename?: 'metadata_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by min() on columns of table "metadata" */
export type Metadata_Min_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  tags?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "metadata" */
export type Metadata_Mutation_Response = {
  __typename?: 'metadata_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Metadata>;
};

/** input type for inserting object relation for remote table "metadata" */
export type Metadata_Obj_Rel_Insert_Input = {
  data: Metadata_Insert_Input;
  /** upsert condition */
  on_conflict?: InputMaybe<Metadata_On_Conflict>;
};

/** on_conflict condition type for table "metadata" */
export type Metadata_On_Conflict = {
  constraint: Metadata_Constraint;
  update_columns?: Array<Metadata_Update_Column>;
  where?: InputMaybe<Metadata_Bool_Exp>;
};

/** Ordering options when selecting data from "metadata". */
export type Metadata_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head?: InputMaybe<Nodes_Order_By>;
  head_cid?: InputMaybe<Order_By>;
  is_archived?: InputMaybe<Order_By>;
  metadata?: InputMaybe<Order_By>;
  metadata_list_by_root_id_aggregate?: InputMaybe<Metadata_Aggregate_Order_By>;
  name?: InputMaybe<Order_By>;
  nodes_aggregate?: InputMaybe<Nodes_Aggregate_Order_By>;
  object_ownership_aggregate?: InputMaybe<Object_Ownership_Aggregate_Order_By>;
  published_objects?: InputMaybe<Published_Objects_Order_By>;
  root_cid?: InputMaybe<Order_By>;
  root_metadata?: InputMaybe<Metadata_Order_By>;
  tags?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: metadata */
export type Metadata_Pk_Columns_Input = {
  head_cid: Scalars['String']['input'];
  root_cid: Scalars['String']['input'];
};

/** prepend existing jsonb value of filtered columns with new jsonb value */
export type Metadata_Prepend_Input = {
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
};

/** columns and relationships of "metadata_roots" */
export type Metadata_Roots = {
  __typename?: 'metadata_roots';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  /** An object relationship */
  inner_metadata?: Maybe<Metadata>;
  is_archived?: Maybe<Scalars['Boolean']['output']>;
  metadata?: Maybe<Scalars['jsonb']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};


/** columns and relationships of "metadata_roots" */
export type Metadata_RootsMetadataArgs = {
  path?: InputMaybe<Scalars['String']['input']>;
};

/** aggregated selection of "metadata_roots" */
export type Metadata_Roots_Aggregate = {
  __typename?: 'metadata_roots_aggregate';
  aggregate?: Maybe<Metadata_Roots_Aggregate_Fields>;
  nodes: Array<Metadata_Roots>;
};

/** aggregate fields of "metadata_roots" */
export type Metadata_Roots_Aggregate_Fields = {
  __typename?: 'metadata_roots_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Metadata_Roots_Max_Fields>;
  min?: Maybe<Metadata_Roots_Min_Fields>;
};


/** aggregate fields of "metadata_roots" */
export type Metadata_Roots_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Metadata_Roots_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** append existing jsonb value of filtered columns with new jsonb value */
export type Metadata_Roots_Append_Input = {
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
};

/** Boolean expression to filter rows from the table "metadata_roots". All fields are combined with a logical 'AND'. */
export type Metadata_Roots_Bool_Exp = {
  _and?: InputMaybe<Array<Metadata_Roots_Bool_Exp>>;
  _not?: InputMaybe<Metadata_Roots_Bool_Exp>;
  _or?: InputMaybe<Array<Metadata_Roots_Bool_Exp>>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  head_cid?: InputMaybe<String_Comparison_Exp>;
  inner_metadata?: InputMaybe<Metadata_Bool_Exp>;
  is_archived?: InputMaybe<Boolean_Comparison_Exp>;
  metadata?: InputMaybe<Jsonb_Comparison_Exp>;
  name?: InputMaybe<String_Comparison_Exp>;
  root_cid?: InputMaybe<String_Comparison_Exp>;
  tags?: InputMaybe<String_Array_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
export type Metadata_Roots_Delete_At_Path_Input = {
  metadata?: InputMaybe<Array<Scalars['String']['input']>>;
};

/** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
export type Metadata_Roots_Delete_Elem_Input = {
  metadata?: InputMaybe<Scalars['Int']['input']>;
};

/** delete key/value pair or string element. key/value pairs are matched based on their key value */
export type Metadata_Roots_Delete_Key_Input = {
  metadata?: InputMaybe<Scalars['String']['input']>;
};

/** input type for inserting data into table "metadata_roots" */
export type Metadata_Roots_Insert_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  inner_metadata?: InputMaybe<Metadata_Obj_Rel_Insert_Input>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate max on columns */
export type Metadata_Roots_Max_Fields = {
  __typename?: 'metadata_roots_max_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Metadata_Roots_Min_Fields = {
  __typename?: 'metadata_roots_min_fields';
  created_at?: Maybe<Scalars['timestamp']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** response of any mutation on the table "metadata_roots" */
export type Metadata_Roots_Mutation_Response = {
  __typename?: 'metadata_roots_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Metadata_Roots>;
};

/** Ordering options when selecting data from "metadata_roots". */
export type Metadata_Roots_Order_By = {
  created_at?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  inner_metadata?: InputMaybe<Metadata_Order_By>;
  is_archived?: InputMaybe<Order_By>;
  metadata?: InputMaybe<Order_By>;
  name?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  tags?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** prepend existing jsonb value of filtered columns with new jsonb value */
export type Metadata_Roots_Prepend_Input = {
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
};

/** select columns of table "metadata_roots" */
export enum Metadata_Roots_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  HeadCid = 'head_cid',
  /** column name */
  IsArchived = 'is_archived',
  /** column name */
  Metadata = 'metadata',
  /** column name */
  Name = 'name',
  /** column name */
  RootCid = 'root_cid',
  /** column name */
  Tags = 'tags',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "metadata_roots" */
export type Metadata_Roots_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** Streaming cursor of the table "metadata_roots" */
export type Metadata_Roots_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Metadata_Roots_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Metadata_Roots_Stream_Cursor_Value_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

export type Metadata_Roots_Updates = {
  /** append existing jsonb value of filtered columns with new jsonb value */
  _append?: InputMaybe<Metadata_Roots_Append_Input>;
  /** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
  _delete_at_path?: InputMaybe<Metadata_Roots_Delete_At_Path_Input>;
  /** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
  _delete_elem?: InputMaybe<Metadata_Roots_Delete_Elem_Input>;
  /** delete key/value pair or string element. key/value pairs are matched based on their key value */
  _delete_key?: InputMaybe<Metadata_Roots_Delete_Key_Input>;
  /** prepend existing jsonb value of filtered columns with new jsonb value */
  _prepend?: InputMaybe<Metadata_Roots_Prepend_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Metadata_Roots_Set_Input>;
  /** filter the rows which have to be updated */
  where: Metadata_Roots_Bool_Exp;
};

/** select columns of table "metadata" */
export enum Metadata_Select_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  HeadCid = 'head_cid',
  /** column name */
  IsArchived = 'is_archived',
  /** column name */
  Metadata = 'metadata',
  /** column name */
  Name = 'name',
  /** column name */
  RootCid = 'root_cid',
  /** column name */
  Tags = 'tags',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** select "metadata_aggregate_bool_exp_bool_and_arguments_columns" columns of table "metadata" */
export enum Metadata_Select_Column_Metadata_Aggregate_Bool_Exp_Bool_And_Arguments_Columns {
  /** column name */
  IsArchived = 'is_archived'
}

/** select "metadata_aggregate_bool_exp_bool_or_arguments_columns" columns of table "metadata" */
export enum Metadata_Select_Column_Metadata_Aggregate_Bool_Exp_Bool_Or_Arguments_Columns {
  /** column name */
  IsArchived = 'is_archived'
}

/** input type for updating data in table "metadata" */
export type Metadata_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

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
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  metadata?: InputMaybe<Scalars['jsonb']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** update columns of table "metadata" */
export enum Metadata_Update_Column {
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  HeadCid = 'head_cid',
  /** column name */
  IsArchived = 'is_archived',
  /** column name */
  Metadata = 'metadata',
  /** column name */
  Name = 'name',
  /** column name */
  RootCid = 'root_cid',
  /** column name */
  Tags = 'tags',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Metadata_Updates = {
  /** append existing jsonb value of filtered columns with new jsonb value */
  _append?: InputMaybe<Metadata_Append_Input>;
  /** delete the field or element with specified path (for JSON arrays, negative integers count from the end) */
  _delete_at_path?: InputMaybe<Metadata_Delete_At_Path_Input>;
  /** delete the array element with specified index (negative integers count from the end). throws an error if top level container is not an array */
  _delete_elem?: InputMaybe<Metadata_Delete_Elem_Input>;
  /** delete key/value pair or string element. key/value pairs are matched based on their key value */
  _delete_key?: InputMaybe<Metadata_Delete_Key_Input>;
  /** prepend existing jsonb value of filtered columns with new jsonb value */
  _prepend?: InputMaybe<Metadata_Prepend_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Metadata_Set_Input>;
  /** filter the rows which have to be updated */
  where: Metadata_Bool_Exp;
};

/** mutation root */
export type Mutation_Root = {
  __typename?: 'mutation_root';
  /** delete data from the table: "async_downloads" */
  delete_async_downloads?: Maybe<Async_Downloads_Mutation_Response>;
  /** delete single row from the table: "async_downloads" */
  delete_async_downloads_by_pk?: Maybe<Async_Downloads>;
  /** delete data from the table: "interactions" */
  delete_interactions?: Maybe<Interactions_Mutation_Response>;
  /** delete data from the table: "metadata" */
  delete_metadata?: Maybe<Metadata_Mutation_Response>;
  /** delete single row from the table: "metadata" */
  delete_metadata_by_pk?: Maybe<Metadata>;
  /** delete data from the table: "metadata_roots" */
  delete_metadata_roots?: Maybe<Metadata_Roots_Mutation_Response>;
  /** delete data from the table: "nodes" */
  delete_nodes?: Maybe<Nodes_Mutation_Response>;
  /** delete single row from the table: "nodes" */
  delete_nodes_by_pk?: Maybe<Nodes>;
  /** delete data from the table: "object_ownership" */
  delete_object_ownership?: Maybe<Object_Ownership_Mutation_Response>;
  /** delete single row from the table: "object_ownership" */
  delete_object_ownership_by_pk?: Maybe<Object_Ownership>;
  /** delete data from the table: "published_objects" */
  delete_published_objects?: Maybe<Published_Objects_Mutation_Response>;
  /** delete single row from the table: "published_objects" */
  delete_published_objects_by_pk?: Maybe<Published_Objects>;
  /** delete data from the table: "subscriptions" */
  delete_subscriptions?: Maybe<Subscriptions_Mutation_Response>;
  /** delete single row from the table: "subscriptions" */
  delete_subscriptions_by_pk?: Maybe<Subscriptions>;
  /** insert data into the table: "async_downloads" */
  insert_async_downloads?: Maybe<Async_Downloads_Mutation_Response>;
  /** insert a single row into the table: "async_downloads" */
  insert_async_downloads_one?: Maybe<Async_Downloads>;
  /** insert data into the table: "interactions" */
  insert_interactions?: Maybe<Interactions_Mutation_Response>;
  /** insert a single row into the table: "interactions" */
  insert_interactions_one?: Maybe<Interactions>;
  /** insert data into the table: "metadata" */
  insert_metadata?: Maybe<Metadata_Mutation_Response>;
  /** insert a single row into the table: "metadata" */
  insert_metadata_one?: Maybe<Metadata>;
  /** insert data into the table: "metadata_roots" */
  insert_metadata_roots?: Maybe<Metadata_Roots_Mutation_Response>;
  /** insert a single row into the table: "metadata_roots" */
  insert_metadata_roots_one?: Maybe<Metadata_Roots>;
  /** insert data into the table: "nodes" */
  insert_nodes?: Maybe<Nodes_Mutation_Response>;
  /** insert a single row into the table: "nodes" */
  insert_nodes_one?: Maybe<Nodes>;
  /** insert data into the table: "object_ownership" */
  insert_object_ownership?: Maybe<Object_Ownership_Mutation_Response>;
  /** insert a single row into the table: "object_ownership" */
  insert_object_ownership_one?: Maybe<Object_Ownership>;
  /** insert data into the table: "published_objects" */
  insert_published_objects?: Maybe<Published_Objects_Mutation_Response>;
  /** insert a single row into the table: "published_objects" */
  insert_published_objects_one?: Maybe<Published_Objects>;
  /** insert data into the table: "subscriptions" */
  insert_subscriptions?: Maybe<Subscriptions_Mutation_Response>;
  /** insert a single row into the table: "subscriptions" */
  insert_subscriptions_one?: Maybe<Subscriptions>;
  /** update data of the table: "async_downloads" */
  update_async_downloads?: Maybe<Async_Downloads_Mutation_Response>;
  /** update single row of the table: "async_downloads" */
  update_async_downloads_by_pk?: Maybe<Async_Downloads>;
  /** update multiples rows of table: "async_downloads" */
  update_async_downloads_many?: Maybe<Array<Maybe<Async_Downloads_Mutation_Response>>>;
  /** update data of the table: "interactions" */
  update_interactions?: Maybe<Interactions_Mutation_Response>;
  /** update multiples rows of table: "interactions" */
  update_interactions_many?: Maybe<Array<Maybe<Interactions_Mutation_Response>>>;
  /** update data of the table: "metadata" */
  update_metadata?: Maybe<Metadata_Mutation_Response>;
  /** update single row of the table: "metadata" */
  update_metadata_by_pk?: Maybe<Metadata>;
  /** update multiples rows of table: "metadata" */
  update_metadata_many?: Maybe<Array<Maybe<Metadata_Mutation_Response>>>;
  /** update data of the table: "metadata_roots" */
  update_metadata_roots?: Maybe<Metadata_Roots_Mutation_Response>;
  /** update multiples rows of table: "metadata_roots" */
  update_metadata_roots_many?: Maybe<Array<Maybe<Metadata_Roots_Mutation_Response>>>;
  /** update data of the table: "nodes" */
  update_nodes?: Maybe<Nodes_Mutation_Response>;
  /** update single row of the table: "nodes" */
  update_nodes_by_pk?: Maybe<Nodes>;
  /** update multiples rows of table: "nodes" */
  update_nodes_many?: Maybe<Array<Maybe<Nodes_Mutation_Response>>>;
  /** update data of the table: "object_ownership" */
  update_object_ownership?: Maybe<Object_Ownership_Mutation_Response>;
  /** update single row of the table: "object_ownership" */
  update_object_ownership_by_pk?: Maybe<Object_Ownership>;
  /** update multiples rows of table: "object_ownership" */
  update_object_ownership_many?: Maybe<Array<Maybe<Object_Ownership_Mutation_Response>>>;
  /** update data of the table: "published_objects" */
  update_published_objects?: Maybe<Published_Objects_Mutation_Response>;
  /** update single row of the table: "published_objects" */
  update_published_objects_by_pk?: Maybe<Published_Objects>;
  /** update multiples rows of table: "published_objects" */
  update_published_objects_many?: Maybe<Array<Maybe<Published_Objects_Mutation_Response>>>;
  /** update data of the table: "subscriptions" */
  update_subscriptions?: Maybe<Subscriptions_Mutation_Response>;
  /** update single row of the table: "subscriptions" */
  update_subscriptions_by_pk?: Maybe<Subscriptions>;
  /** update multiples rows of table: "subscriptions" */
  update_subscriptions_many?: Maybe<Array<Maybe<Subscriptions_Mutation_Response>>>;
};


/** mutation root */
export type Mutation_RootDelete_Async_DownloadsArgs = {
  where: Async_Downloads_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Async_Downloads_By_PkArgs = {
  id: Scalars['String']['input'];
};


/** mutation root */
export type Mutation_RootDelete_InteractionsArgs = {
  where: Interactions_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_MetadataArgs = {
  where: Metadata_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Metadata_By_PkArgs = {
  head_cid: Scalars['String']['input'];
  root_cid: Scalars['String']['input'];
};


/** mutation root */
export type Mutation_RootDelete_Metadata_RootsArgs = {
  where: Metadata_Roots_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_NodesArgs = {
  where: Nodes_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Nodes_By_PkArgs = {
  cid: Scalars['String']['input'];
};


/** mutation root */
export type Mutation_RootDelete_Object_OwnershipArgs = {
  where: Object_Ownership_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Object_Ownership_By_PkArgs = {
  cid: Scalars['String']['input'];
  oauth_provider: Scalars['String']['input'];
  oauth_user_id: Scalars['String']['input'];
};


/** mutation root */
export type Mutation_RootDelete_Published_ObjectsArgs = {
  where: Published_Objects_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Published_Objects_By_PkArgs = {
  id: Scalars['String']['input'];
};


/** mutation root */
export type Mutation_RootDelete_SubscriptionsArgs = {
  where: Subscriptions_Bool_Exp;
};


/** mutation root */
export type Mutation_RootDelete_Subscriptions_By_PkArgs = {
  id: Scalars['String']['input'];
};


/** mutation root */
export type Mutation_RootInsert_Async_DownloadsArgs = {
  objects: Array<Async_Downloads_Insert_Input>;
  on_conflict?: InputMaybe<Async_Downloads_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Async_Downloads_OneArgs = {
  object: Async_Downloads_Insert_Input;
  on_conflict?: InputMaybe<Async_Downloads_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_InteractionsArgs = {
  objects: Array<Interactions_Insert_Input>;
};


/** mutation root */
export type Mutation_RootInsert_Interactions_OneArgs = {
  object: Interactions_Insert_Input;
};


/** mutation root */
export type Mutation_RootInsert_MetadataArgs = {
  objects: Array<Metadata_Insert_Input>;
  on_conflict?: InputMaybe<Metadata_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Metadata_OneArgs = {
  object: Metadata_Insert_Input;
  on_conflict?: InputMaybe<Metadata_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Metadata_RootsArgs = {
  objects: Array<Metadata_Roots_Insert_Input>;
};


/** mutation root */
export type Mutation_RootInsert_Metadata_Roots_OneArgs = {
  object: Metadata_Roots_Insert_Input;
};


/** mutation root */
export type Mutation_RootInsert_NodesArgs = {
  objects: Array<Nodes_Insert_Input>;
  on_conflict?: InputMaybe<Nodes_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Nodes_OneArgs = {
  object: Nodes_Insert_Input;
  on_conflict?: InputMaybe<Nodes_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Object_OwnershipArgs = {
  objects: Array<Object_Ownership_Insert_Input>;
  on_conflict?: InputMaybe<Object_Ownership_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Object_Ownership_OneArgs = {
  object: Object_Ownership_Insert_Input;
  on_conflict?: InputMaybe<Object_Ownership_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Published_ObjectsArgs = {
  objects: Array<Published_Objects_Insert_Input>;
  on_conflict?: InputMaybe<Published_Objects_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Published_Objects_OneArgs = {
  object: Published_Objects_Insert_Input;
  on_conflict?: InputMaybe<Published_Objects_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_SubscriptionsArgs = {
  objects: Array<Subscriptions_Insert_Input>;
  on_conflict?: InputMaybe<Subscriptions_On_Conflict>;
};


/** mutation root */
export type Mutation_RootInsert_Subscriptions_OneArgs = {
  object: Subscriptions_Insert_Input;
  on_conflict?: InputMaybe<Subscriptions_On_Conflict>;
};


/** mutation root */
export type Mutation_RootUpdate_Async_DownloadsArgs = {
  _inc?: InputMaybe<Async_Downloads_Inc_Input>;
  _set?: InputMaybe<Async_Downloads_Set_Input>;
  where: Async_Downloads_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Async_Downloads_By_PkArgs = {
  _inc?: InputMaybe<Async_Downloads_Inc_Input>;
  _set?: InputMaybe<Async_Downloads_Set_Input>;
  pk_columns: Async_Downloads_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Async_Downloads_ManyArgs = {
  updates: Array<Async_Downloads_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_InteractionsArgs = {
  _inc?: InputMaybe<Interactions_Inc_Input>;
  _set?: InputMaybe<Interactions_Set_Input>;
  where: Interactions_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Interactions_ManyArgs = {
  updates: Array<Interactions_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_MetadataArgs = {
  _append?: InputMaybe<Metadata_Append_Input>;
  _delete_at_path?: InputMaybe<Metadata_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Metadata_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Metadata_Delete_Key_Input>;
  _prepend?: InputMaybe<Metadata_Prepend_Input>;
  _set?: InputMaybe<Metadata_Set_Input>;
  where: Metadata_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Metadata_By_PkArgs = {
  _append?: InputMaybe<Metadata_Append_Input>;
  _delete_at_path?: InputMaybe<Metadata_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Metadata_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Metadata_Delete_Key_Input>;
  _prepend?: InputMaybe<Metadata_Prepend_Input>;
  _set?: InputMaybe<Metadata_Set_Input>;
  pk_columns: Metadata_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Metadata_ManyArgs = {
  updates: Array<Metadata_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_Metadata_RootsArgs = {
  _append?: InputMaybe<Metadata_Roots_Append_Input>;
  _delete_at_path?: InputMaybe<Metadata_Roots_Delete_At_Path_Input>;
  _delete_elem?: InputMaybe<Metadata_Roots_Delete_Elem_Input>;
  _delete_key?: InputMaybe<Metadata_Roots_Delete_Key_Input>;
  _prepend?: InputMaybe<Metadata_Roots_Prepend_Input>;
  _set?: InputMaybe<Metadata_Roots_Set_Input>;
  where: Metadata_Roots_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Metadata_Roots_ManyArgs = {
  updates: Array<Metadata_Roots_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_NodesArgs = {
  _inc?: InputMaybe<Nodes_Inc_Input>;
  _set?: InputMaybe<Nodes_Set_Input>;
  where: Nodes_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Nodes_By_PkArgs = {
  _inc?: InputMaybe<Nodes_Inc_Input>;
  _set?: InputMaybe<Nodes_Set_Input>;
  pk_columns: Nodes_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Nodes_ManyArgs = {
  updates: Array<Nodes_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_Object_OwnershipArgs = {
  _set?: InputMaybe<Object_Ownership_Set_Input>;
  where: Object_Ownership_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Object_Ownership_By_PkArgs = {
  _set?: InputMaybe<Object_Ownership_Set_Input>;
  pk_columns: Object_Ownership_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Object_Ownership_ManyArgs = {
  updates: Array<Object_Ownership_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_Published_ObjectsArgs = {
  _set?: InputMaybe<Published_Objects_Set_Input>;
  where: Published_Objects_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Published_Objects_By_PkArgs = {
  _set?: InputMaybe<Published_Objects_Set_Input>;
  pk_columns: Published_Objects_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Published_Objects_ManyArgs = {
  updates: Array<Published_Objects_Updates>;
};


/** mutation root */
export type Mutation_RootUpdate_SubscriptionsArgs = {
  _inc?: InputMaybe<Subscriptions_Inc_Input>;
  _set?: InputMaybe<Subscriptions_Set_Input>;
  where: Subscriptions_Bool_Exp;
};


/** mutation root */
export type Mutation_RootUpdate_Subscriptions_By_PkArgs = {
  _inc?: InputMaybe<Subscriptions_Inc_Input>;
  _set?: InputMaybe<Subscriptions_Set_Input>;
  pk_columns: Subscriptions_Pk_Columns_Input;
};


/** mutation root */
export type Mutation_RootUpdate_Subscriptions_ManyArgs = {
  updates: Array<Subscriptions_Updates>;
};

/** columns and relationships of "nodes" */
export type Nodes = {
  __typename?: 'nodes';
  block_published_on?: Maybe<Scalars['Int']['output']>;
  cid: Scalars['String']['output'];
  created_at?: Maybe<Scalars['timestamp']['output']>;
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
  tx_published_on?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['timestamp']['output'];
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

/** input type for inserting array relation for remote table "nodes" */
export type Nodes_Arr_Rel_Insert_Input = {
  data: Array<Nodes_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Nodes_On_Conflict>;
};

/** aggregate avg on columns */
export type Nodes_Avg_Fields = {
  __typename?: 'nodes_avg_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by avg() on columns of table "nodes" */
export type Nodes_Avg_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** Boolean expression to filter rows from the table "nodes". All fields are combined with a logical 'AND'. */
export type Nodes_Bool_Exp = {
  _and?: InputMaybe<Array<Nodes_Bool_Exp>>;
  _not?: InputMaybe<Nodes_Bool_Exp>;
  _or?: InputMaybe<Array<Nodes_Bool_Exp>>;
  block_published_on?: InputMaybe<Int_Comparison_Exp>;
  cid?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  encoded_node?: InputMaybe<String_Comparison_Exp>;
  head_cid?: InputMaybe<String_Comparison_Exp>;
  nodes?: InputMaybe<Metadata_Bool_Exp>;
  nodes_aggregate?: InputMaybe<Metadata_Aggregate_Bool_Exp>;
  piece_index?: InputMaybe<Int_Comparison_Exp>;
  piece_offset?: InputMaybe<Int_Comparison_Exp>;
  root?: InputMaybe<Nodes_Bool_Exp>;
  root_cid?: InputMaybe<String_Comparison_Exp>;
  tx_published_on?: InputMaybe<String_Comparison_Exp>;
  type?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** unique or primary key constraints on table "nodes" */
export enum Nodes_Constraint {
  /** unique or primary key constraint on columns "cid" */
  NodesPkey = 'nodes_pkey'
}

/** input type for incrementing numeric columns in table "nodes" */
export type Nodes_Inc_Input = {
  block_published_on?: InputMaybe<Scalars['Int']['input']>;
  piece_index?: InputMaybe<Scalars['Int']['input']>;
  piece_offset?: InputMaybe<Scalars['Int']['input']>;
};

/** input type for inserting data into table "nodes" */
export type Nodes_Insert_Input = {
  block_published_on?: InputMaybe<Scalars['Int']['input']>;
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  encoded_node?: InputMaybe<Scalars['String']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  nodes?: InputMaybe<Metadata_Arr_Rel_Insert_Input>;
  piece_index?: InputMaybe<Scalars['Int']['input']>;
  piece_offset?: InputMaybe<Scalars['Int']['input']>;
  root?: InputMaybe<Nodes_Obj_Rel_Insert_Input>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tx_published_on?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate max on columns */
export type Nodes_Max_Fields = {
  __typename?: 'nodes_max_fields';
  block_published_on?: Maybe<Scalars['Int']['output']>;
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  encoded_node?: Maybe<Scalars['String']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tx_published_on?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by max() on columns of table "nodes" */
export type Nodes_Max_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  encoded_node?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  tx_published_on?: InputMaybe<Order_By>;
  type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** aggregate min on columns */
export type Nodes_Min_Fields = {
  __typename?: 'nodes_min_fields';
  block_published_on?: Maybe<Scalars['Int']['output']>;
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  encoded_node?: Maybe<Scalars['String']['output']>;
  head_cid?: Maybe<Scalars['String']['output']>;
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
  root_cid?: Maybe<Scalars['String']['output']>;
  tx_published_on?: Maybe<Scalars['String']['output']>;
  type?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** order by min() on columns of table "nodes" */
export type Nodes_Min_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  encoded_node?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
  root_cid?: InputMaybe<Order_By>;
  tx_published_on?: InputMaybe<Order_By>;
  type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** response of any mutation on the table "nodes" */
export type Nodes_Mutation_Response = {
  __typename?: 'nodes_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Nodes>;
};

/** input type for inserting object relation for remote table "nodes" */
export type Nodes_Obj_Rel_Insert_Input = {
  data: Nodes_Insert_Input;
  /** upsert condition */
  on_conflict?: InputMaybe<Nodes_On_Conflict>;
};

/** on_conflict condition type for table "nodes" */
export type Nodes_On_Conflict = {
  constraint: Nodes_Constraint;
  update_columns?: Array<Nodes_Update_Column>;
  where?: InputMaybe<Nodes_Bool_Exp>;
};

/** Ordering options when selecting data from "nodes". */
export type Nodes_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  encoded_node?: InputMaybe<Order_By>;
  head_cid?: InputMaybe<Order_By>;
  nodes_aggregate?: InputMaybe<Metadata_Aggregate_Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
  root?: InputMaybe<Nodes_Order_By>;
  root_cid?: InputMaybe<Order_By>;
  tx_published_on?: InputMaybe<Order_By>;
  type?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: nodes */
export type Nodes_Pk_Columns_Input = {
  cid: Scalars['String']['input'];
};

/** select columns of table "nodes" */
export enum Nodes_Select_Column {
  /** column name */
  BlockPublishedOn = 'block_published_on',
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
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
  TxPublishedOn = 'tx_published_on',
  /** column name */
  Type = 'type',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "nodes" */
export type Nodes_Set_Input = {
  block_published_on?: InputMaybe<Scalars['Int']['input']>;
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  encoded_node?: InputMaybe<Scalars['String']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  piece_index?: InputMaybe<Scalars['Int']['input']>;
  piece_offset?: InputMaybe<Scalars['Int']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tx_published_on?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate stddev on columns */
export type Nodes_Stddev_Fields = {
  __typename?: 'nodes_stddev_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by stddev() on columns of table "nodes" */
export type Nodes_Stddev_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate stddev_pop on columns */
export type Nodes_Stddev_Pop_Fields = {
  __typename?: 'nodes_stddev_pop_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by stddev_pop() on columns of table "nodes" */
export type Nodes_Stddev_Pop_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate stddev_samp on columns */
export type Nodes_Stddev_Samp_Fields = {
  __typename?: 'nodes_stddev_samp_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by stddev_samp() on columns of table "nodes" */
export type Nodes_Stddev_Samp_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
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
  block_published_on?: InputMaybe<Scalars['Int']['input']>;
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  encoded_node?: InputMaybe<Scalars['String']['input']>;
  head_cid?: InputMaybe<Scalars['String']['input']>;
  piece_index?: InputMaybe<Scalars['Int']['input']>;
  piece_offset?: InputMaybe<Scalars['Int']['input']>;
  root_cid?: InputMaybe<Scalars['String']['input']>;
  tx_published_on?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate sum on columns */
export type Nodes_Sum_Fields = {
  __typename?: 'nodes_sum_fields';
  block_published_on?: Maybe<Scalars['Int']['output']>;
  piece_index?: Maybe<Scalars['Int']['output']>;
  piece_offset?: Maybe<Scalars['Int']['output']>;
};

/** order by sum() on columns of table "nodes" */
export type Nodes_Sum_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** update columns of table "nodes" */
export enum Nodes_Update_Column {
  /** column name */
  BlockPublishedOn = 'block_published_on',
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
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
  TxPublishedOn = 'tx_published_on',
  /** column name */
  Type = 'type',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Nodes_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Nodes_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Nodes_Set_Input>;
  /** filter the rows which have to be updated */
  where: Nodes_Bool_Exp;
};

/** aggregate var_pop on columns */
export type Nodes_Var_Pop_Fields = {
  __typename?: 'nodes_var_pop_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by var_pop() on columns of table "nodes" */
export type Nodes_Var_Pop_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate var_samp on columns */
export type Nodes_Var_Samp_Fields = {
  __typename?: 'nodes_var_samp_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by var_samp() on columns of table "nodes" */
export type Nodes_Var_Samp_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
  piece_index?: InputMaybe<Order_By>;
  piece_offset?: InputMaybe<Order_By>;
};

/** aggregate variance on columns */
export type Nodes_Variance_Fields = {
  __typename?: 'nodes_variance_fields';
  block_published_on?: Maybe<Scalars['Float']['output']>;
  piece_index?: Maybe<Scalars['Float']['output']>;
  piece_offset?: Maybe<Scalars['Float']['output']>;
};

/** order by variance() on columns of table "nodes" */
export type Nodes_Variance_Order_By = {
  block_published_on?: InputMaybe<Order_By>;
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

/** input type for inserting array relation for remote table "object_ownership" */
export type Object_Ownership_Arr_Rel_Insert_Input = {
  data: Array<Object_Ownership_Insert_Input>;
  /** upsert condition */
  on_conflict?: InputMaybe<Object_Ownership_On_Conflict>;
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
};

/** unique or primary key constraints on table "object_ownership" */
export enum Object_Ownership_Constraint {
  /** unique or primary key constraint on columns "oauth_user_id", "cid", "oauth_provider" */
  ObjectOwnershipPkey = 'object_ownership_pkey'
}

/** input type for inserting data into table "object_ownership" */
export type Object_Ownership_Insert_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  is_admin?: InputMaybe<Scalars['Boolean']['input']>;
  marked_as_deleted?: InputMaybe<Scalars['timestamp']['input']>;
  metadata?: InputMaybe<Metadata_Obj_Rel_Insert_Input>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
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

/** response of any mutation on the table "object_ownership" */
export type Object_Ownership_Mutation_Response = {
  __typename?: 'object_ownership_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Object_Ownership>;
};

/** on_conflict condition type for table "object_ownership" */
export type Object_Ownership_On_Conflict = {
  constraint: Object_Ownership_Constraint;
  update_columns?: Array<Object_Ownership_Update_Column>;
  where?: InputMaybe<Object_Ownership_Bool_Exp>;
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
};

/** primary key columns input for table: object_ownership */
export type Object_Ownership_Pk_Columns_Input = {
  cid: Scalars['String']['input'];
  oauth_provider: Scalars['String']['input'];
  oauth_user_id: Scalars['String']['input'];
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

/** input type for updating data in table "object_ownership" */
export type Object_Ownership_Set_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  is_admin?: InputMaybe<Scalars['Boolean']['input']>;
  marked_as_deleted?: InputMaybe<Scalars['timestamp']['input']>;
  oauth_provider?: InputMaybe<Scalars['String']['input']>;
  oauth_user_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

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

/** update columns of table "object_ownership" */
export enum Object_Ownership_Update_Column {
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

export type Object_Ownership_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Object_Ownership_Set_Input>;
  /** filter the rows which have to be updated */
  where: Object_Ownership_Bool_Exp;
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

/** columns and relationships of "published_objects" */
export type Published_Objects = {
  __typename?: 'published_objects';
  cid: Scalars['String']['output'];
  created_at: Scalars['timestamp']['output'];
  id: Scalars['String']['output'];
  public_id: Scalars['String']['output'];
  updated_at: Scalars['timestamp']['output'];
};

/** aggregated selection of "published_objects" */
export type Published_Objects_Aggregate = {
  __typename?: 'published_objects_aggregate';
  aggregate?: Maybe<Published_Objects_Aggregate_Fields>;
  nodes: Array<Published_Objects>;
};

/** aggregate fields of "published_objects" */
export type Published_Objects_Aggregate_Fields = {
  __typename?: 'published_objects_aggregate_fields';
  count: Scalars['Int']['output'];
  max?: Maybe<Published_Objects_Max_Fields>;
  min?: Maybe<Published_Objects_Min_Fields>;
};


/** aggregate fields of "published_objects" */
export type Published_Objects_Aggregate_FieldsCountArgs = {
  columns?: InputMaybe<Array<Published_Objects_Select_Column>>;
  distinct?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Boolean expression to filter rows from the table "published_objects". All fields are combined with a logical 'AND'. */
export type Published_Objects_Bool_Exp = {
  _and?: InputMaybe<Array<Published_Objects_Bool_Exp>>;
  _not?: InputMaybe<Published_Objects_Bool_Exp>;
  _or?: InputMaybe<Array<Published_Objects_Bool_Exp>>;
  cid?: InputMaybe<String_Comparison_Exp>;
  created_at?: InputMaybe<Timestamp_Comparison_Exp>;
  id?: InputMaybe<String_Comparison_Exp>;
  public_id?: InputMaybe<String_Comparison_Exp>;
  updated_at?: InputMaybe<Timestamp_Comparison_Exp>;
};

/** unique or primary key constraints on table "published_objects" */
export enum Published_Objects_Constraint {
  /** unique or primary key constraint on columns "id" */
  PublishedObjectsPkey = 'published_objects_pkey'
}

/** input type for inserting data into table "published_objects" */
export type Published_Objects_Insert_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  public_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** aggregate max on columns */
export type Published_Objects_Max_Fields = {
  __typename?: 'published_objects_max_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  public_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** aggregate min on columns */
export type Published_Objects_Min_Fields = {
  __typename?: 'published_objects_min_fields';
  cid?: Maybe<Scalars['String']['output']>;
  created_at?: Maybe<Scalars['timestamp']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  public_id?: Maybe<Scalars['String']['output']>;
  updated_at?: Maybe<Scalars['timestamp']['output']>;
};

/** response of any mutation on the table "published_objects" */
export type Published_Objects_Mutation_Response = {
  __typename?: 'published_objects_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Published_Objects>;
};

/** input type for inserting object relation for remote table "published_objects" */
export type Published_Objects_Obj_Rel_Insert_Input = {
  data: Published_Objects_Insert_Input;
  /** upsert condition */
  on_conflict?: InputMaybe<Published_Objects_On_Conflict>;
};

/** on_conflict condition type for table "published_objects" */
export type Published_Objects_On_Conflict = {
  constraint: Published_Objects_Constraint;
  update_columns?: Array<Published_Objects_Update_Column>;
  where?: InputMaybe<Published_Objects_Bool_Exp>;
};

/** Ordering options when selecting data from "published_objects". */
export type Published_Objects_Order_By = {
  cid?: InputMaybe<Order_By>;
  created_at?: InputMaybe<Order_By>;
  id?: InputMaybe<Order_By>;
  public_id?: InputMaybe<Order_By>;
  updated_at?: InputMaybe<Order_By>;
};

/** primary key columns input for table: published_objects */
export type Published_Objects_Pk_Columns_Input = {
  id: Scalars['String']['input'];
};

/** select columns of table "published_objects" */
export enum Published_Objects_Select_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  PublicId = 'public_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

/** input type for updating data in table "published_objects" */
export type Published_Objects_Set_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  public_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** Streaming cursor of the table "published_objects" */
export type Published_Objects_Stream_Cursor_Input = {
  /** Stream column input with initial value */
  initial_value: Published_Objects_Stream_Cursor_Value_Input;
  /** cursor ordering */
  ordering?: InputMaybe<Cursor_Ordering>;
};

/** Initial value of the column from where the streaming should start */
export type Published_Objects_Stream_Cursor_Value_Input = {
  cid?: InputMaybe<Scalars['String']['input']>;
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  public_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
};

/** update columns of table "published_objects" */
export enum Published_Objects_Update_Column {
  /** column name */
  Cid = 'cid',
  /** column name */
  CreatedAt = 'created_at',
  /** column name */
  Id = 'id',
  /** column name */
  PublicId = 'public_id',
  /** column name */
  UpdatedAt = 'updated_at'
}

export type Published_Objects_Updates = {
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Published_Objects_Set_Input>;
  /** filter the rows which have to be updated */
  where: Published_Objects_Bool_Exp;
};

export type Query_Root = {
  __typename?: 'query_root';
  /** fetch data from the table: "async_downloads" */
  async_downloads: Array<Async_Downloads>;
  /** fetch aggregated fields from the table: "async_downloads" */
  async_downloads_aggregate: Async_Downloads_Aggregate;
  /** fetch data from the table: "async_downloads" using primary key columns */
  async_downloads_by_pk?: Maybe<Async_Downloads>;
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
  /** fetch data from the table: "metadata_roots" */
  metadata_roots: Array<Metadata_Roots>;
  /** fetch aggregated fields from the table: "metadata_roots" */
  metadata_roots_aggregate: Metadata_Roots_Aggregate;
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
  /** fetch data from the table: "published_objects" */
  published_objects: Array<Published_Objects>;
  /** fetch aggregated fields from the table: "published_objects" */
  published_objects_aggregate: Published_Objects_Aggregate;
  /** fetch data from the table: "published_objects" using primary key columns */
  published_objects_by_pk?: Maybe<Published_Objects>;
  /** fetch data from the table: "subscriptions" */
  subscriptions: Array<Subscriptions>;
  /** fetch aggregated fields from the table: "subscriptions" */
  subscriptions_aggregate: Subscriptions_Aggregate;
  /** fetch data from the table: "subscriptions" using primary key columns */
  subscriptions_by_pk?: Maybe<Subscriptions>;
};


export type Query_RootAsync_DownloadsArgs = {
  distinct_on?: InputMaybe<Array<Async_Downloads_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Async_Downloads_Order_By>>;
  where?: InputMaybe<Async_Downloads_Bool_Exp>;
};


export type Query_RootAsync_Downloads_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Async_Downloads_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Async_Downloads_Order_By>>;
  where?: InputMaybe<Async_Downloads_Bool_Exp>;
};


export type Query_RootAsync_Downloads_By_PkArgs = {
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


export type Query_RootMetadata_RootsArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Roots_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Roots_Order_By>>;
  where?: InputMaybe<Metadata_Roots_Bool_Exp>;
};


export type Query_RootMetadata_Roots_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Roots_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Roots_Order_By>>;
  where?: InputMaybe<Metadata_Roots_Bool_Exp>;
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


export type Query_RootPublished_ObjectsArgs = {
  distinct_on?: InputMaybe<Array<Published_Objects_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Published_Objects_Order_By>>;
  where?: InputMaybe<Published_Objects_Bool_Exp>;
};


export type Query_RootPublished_Objects_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Published_Objects_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Published_Objects_Order_By>>;
  where?: InputMaybe<Published_Objects_Bool_Exp>;
};


export type Query_RootPublished_Objects_By_PkArgs = {
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

export type Subscription_Root = {
  __typename?: 'subscription_root';
  /** fetch data from the table: "async_downloads" */
  async_downloads: Array<Async_Downloads>;
  /** fetch aggregated fields from the table: "async_downloads" */
  async_downloads_aggregate: Async_Downloads_Aggregate;
  /** fetch data from the table: "async_downloads" using primary key columns */
  async_downloads_by_pk?: Maybe<Async_Downloads>;
  /** fetch data from the table in a streaming manner: "async_downloads" */
  async_downloads_stream: Array<Async_Downloads>;
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
  /** fetch data from the table: "metadata_roots" */
  metadata_roots: Array<Metadata_Roots>;
  /** fetch aggregated fields from the table: "metadata_roots" */
  metadata_roots_aggregate: Metadata_Roots_Aggregate;
  /** fetch data from the table in a streaming manner: "metadata_roots" */
  metadata_roots_stream: Array<Metadata_Roots>;
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
  /** fetch data from the table: "published_objects" */
  published_objects: Array<Published_Objects>;
  /** fetch aggregated fields from the table: "published_objects" */
  published_objects_aggregate: Published_Objects_Aggregate;
  /** fetch data from the table: "published_objects" using primary key columns */
  published_objects_by_pk?: Maybe<Published_Objects>;
  /** fetch data from the table in a streaming manner: "published_objects" */
  published_objects_stream: Array<Published_Objects>;
  /** fetch data from the table: "subscriptions" */
  subscriptions: Array<Subscriptions>;
  /** fetch aggregated fields from the table: "subscriptions" */
  subscriptions_aggregate: Subscriptions_Aggregate;
  /** fetch data from the table: "subscriptions" using primary key columns */
  subscriptions_by_pk?: Maybe<Subscriptions>;
  /** fetch data from the table in a streaming manner: "subscriptions" */
  subscriptions_stream: Array<Subscriptions>;
};


export type Subscription_RootAsync_DownloadsArgs = {
  distinct_on?: InputMaybe<Array<Async_Downloads_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Async_Downloads_Order_By>>;
  where?: InputMaybe<Async_Downloads_Bool_Exp>;
};


export type Subscription_RootAsync_Downloads_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Async_Downloads_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Async_Downloads_Order_By>>;
  where?: InputMaybe<Async_Downloads_Bool_Exp>;
};


export type Subscription_RootAsync_Downloads_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootAsync_Downloads_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Async_Downloads_Stream_Cursor_Input>>;
  where?: InputMaybe<Async_Downloads_Bool_Exp>;
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


export type Subscription_RootMetadata_RootsArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Roots_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Roots_Order_By>>;
  where?: InputMaybe<Metadata_Roots_Bool_Exp>;
};


export type Subscription_RootMetadata_Roots_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Metadata_Roots_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Metadata_Roots_Order_By>>;
  where?: InputMaybe<Metadata_Roots_Bool_Exp>;
};


export type Subscription_RootMetadata_Roots_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Metadata_Roots_Stream_Cursor_Input>>;
  where?: InputMaybe<Metadata_Roots_Bool_Exp>;
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


export type Subscription_RootPublished_ObjectsArgs = {
  distinct_on?: InputMaybe<Array<Published_Objects_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Published_Objects_Order_By>>;
  where?: InputMaybe<Published_Objects_Bool_Exp>;
};


export type Subscription_RootPublished_Objects_AggregateArgs = {
  distinct_on?: InputMaybe<Array<Published_Objects_Select_Column>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order_by?: InputMaybe<Array<Published_Objects_Order_By>>;
  where?: InputMaybe<Published_Objects_Bool_Exp>;
};


export type Subscription_RootPublished_Objects_By_PkArgs = {
  id: Scalars['String']['input'];
};


export type Subscription_RootPublished_Objects_StreamArgs = {
  batch_size: Scalars['Int']['input'];
  cursor: Array<InputMaybe<Published_Objects_Stream_Cursor_Input>>;
  where?: InputMaybe<Published_Objects_Bool_Exp>;
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

/** unique or primary key constraints on table "subscriptions" */
export enum Subscriptions_Constraint {
  /** unique or primary key constraint on columns "id" */
  SubscriptionsPkey = 'subscriptions_pkey'
}

/** input type for incrementing numeric columns in table "subscriptions" */
export type Subscriptions_Inc_Input = {
  download_limit?: InputMaybe<Scalars['bigint']['input']>;
  upload_limit?: InputMaybe<Scalars['bigint']['input']>;
};

/** input type for inserting data into table "subscriptions" */
export type Subscriptions_Insert_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  download_limit?: InputMaybe<Scalars['bigint']['input']>;
  granularity?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  organization_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
  upload_limit?: InputMaybe<Scalars['bigint']['input']>;
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

/** response of any mutation on the table "subscriptions" */
export type Subscriptions_Mutation_Response = {
  __typename?: 'subscriptions_mutation_response';
  /** number of rows affected by the mutation */
  affected_rows: Scalars['Int']['output'];
  /** data from the rows affected by the mutation */
  returning: Array<Subscriptions>;
};

/** on_conflict condition type for table "subscriptions" */
export type Subscriptions_On_Conflict = {
  constraint: Subscriptions_Constraint;
  update_columns?: Array<Subscriptions_Update_Column>;
  where?: InputMaybe<Subscriptions_Bool_Exp>;
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

/** primary key columns input for table: subscriptions */
export type Subscriptions_Pk_Columns_Input = {
  id: Scalars['String']['input'];
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

/** input type for updating data in table "subscriptions" */
export type Subscriptions_Set_Input = {
  created_at?: InputMaybe<Scalars['timestamp']['input']>;
  download_limit?: InputMaybe<Scalars['bigint']['input']>;
  granularity?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  organization_id?: InputMaybe<Scalars['String']['input']>;
  updated_at?: InputMaybe<Scalars['timestamp']['input']>;
  upload_limit?: InputMaybe<Scalars['bigint']['input']>;
};

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

/** update columns of table "subscriptions" */
export enum Subscriptions_Update_Column {
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

export type Subscriptions_Updates = {
  /** increments the numeric columns with given value of the filtered values */
  _inc?: InputMaybe<Subscriptions_Inc_Input>;
  /** sets the columns of the filtered rows to the given values */
  _set?: InputMaybe<Subscriptions_Set_Input>;
  /** filter the rows which have to be updated */
  where: Subscriptions_Bool_Exp;
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

export type FilesToBeReviewedQueryVariables = Exact<{
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
}>;


export type FilesToBeReviewedQuery = { __typename?: 'query_root', metadata_roots: Array<{ __typename?: 'metadata_roots', headCid?: string | null }> };

export type MyUndismissedAsyncDownloadsQueryVariables = Exact<{ [key: string]: never; }>;


export type MyUndismissedAsyncDownloadsQuery = { __typename?: 'query_root', async_downloads: Array<{ __typename?: 'async_downloads', id: string, cid: string, status: string, oauthProvider: string, oauthUserId: string, errorMessage?: string | null, fileSize?: any | null, downloadedBytes?: any | null, createdAt: any, updatedAt: any }> };

export type GetGlobalFilesQueryVariables = Exact<{
  aggregateLimit: Scalars['Int']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  orderBy?: InputMaybe<Array<Metadata_Roots_Order_By> | Metadata_Roots_Order_By>;
  search?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetGlobalFilesQuery = { __typename?: 'query_root', metadata_roots: Array<{ __typename?: 'metadata_roots', tags?: Array<string> | null, cid?: string | null, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, createdAt?: any | null, inner_metadata?: { __typename?: 'metadata', maximumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', is_admin?: boolean | null, oauth_provider: string, oauth_user_id: string }> } | null }>, metadata_roots_aggregate: { __typename?: 'metadata_roots_aggregate', aggregate?: { __typename?: 'metadata_roots_aggregate_fields', count: number } | null } };

export type GetSharedFilesQueryVariables = Exact<{
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  orderBy?: InputMaybe<Array<Metadata_Roots_Order_By> | Metadata_Roots_Order_By>;
  aggregateLimit: Scalars['Int']['input'];
}>;


export type GetSharedFilesQuery = { __typename?: 'query_root', metadata_roots: Array<{ __typename?: 'metadata_roots', tags?: Array<string> | null, cid?: string | null, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, createdAt?: any | null, inner_metadata?: { __typename?: 'metadata', maximumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', oauth_provider: string, oauth_user_id: string, is_admin?: boolean | null }> } | null }>, metadata_roots_aggregate: { __typename?: 'metadata_roots_aggregate', aggregate?: { __typename?: 'metadata_roots_aggregate_fields', count: number } | null } };

export type GetTrashedFilesQueryVariables = Exact<{
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  orderBy?: InputMaybe<Array<Metadata_Roots_Order_By> | Metadata_Roots_Order_By>;
  aggregateLimit: Scalars['Int']['input'];
}>;


export type GetTrashedFilesQuery = { __typename?: 'query_root', metadata_roots: Array<{ __typename?: 'metadata_roots', tags?: Array<string> | null, created_at?: any | null, cid?: string | null, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, inner_metadata?: { __typename?: 'metadata', published_objects?: { __typename?: 'published_objects', id: string } | null, maximumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', oauth_provider: string, oauth_user_id: string, is_admin?: boolean | null }> } | null }>, metadata_roots_aggregate: { __typename?: 'metadata_roots_aggregate', aggregate?: { __typename?: 'metadata_roots_aggregate_fields', count: number } | null } };

export type GetMyFilesQueryVariables = Exact<{
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  orderBy?: InputMaybe<Array<Metadata_Roots_Order_By> | Metadata_Roots_Order_By>;
  search: Scalars['String']['input'];
  aggregateLimit: Scalars['Int']['input'];
}>;


export type GetMyFilesQuery = { __typename?: 'query_root', metadata_roots: Array<{ __typename?: 'metadata_roots', tags?: Array<string> | null, created_at?: any | null, cid?: string | null, type?: any | null, name?: any | null, mimeType?: any | null, size?: any | null, children?: any | null, inner_metadata?: { __typename?: 'metadata', published_objects?: { __typename?: 'published_objects', id: string } | null, maximumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', oauth_provider: string, oauth_user_id: string, is_admin?: boolean | null }> } | null }>, metadata_roots_aggregate: { __typename?: 'metadata_roots_aggregate', aggregate?: { __typename?: 'metadata_roots_aggregate_fields', count: number } | null } };

export type GetMetadataByHeadCidQueryVariables = Exact<{
  headCid: Scalars['String']['input'];
}>;


export type GetMetadataByHeadCidQuery = { __typename?: 'query_root', metadata: Array<{ __typename?: 'metadata', head_cid: string, tags?: Array<string> | null, metadata?: any | null, created_at?: any | null, published_objects?: { __typename?: 'published_objects', id: string } | null, maximumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, minimumBlockDepth: Array<{ __typename?: 'nodes', block_published_on?: number | null, tx_published_on?: string | null }>, publishedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, archivedNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, totalNodes: { __typename?: 'nodes_aggregate', aggregate?: { __typename?: 'nodes_aggregate_fields', count: number } | null }, object_ownership: Array<{ __typename?: 'object_ownership', oauth_user_id: string, oauth_provider: string, is_admin?: boolean | null }> }> };

export type SearchGlobalMetadataByCidOrNameQueryVariables = Exact<{
  search: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
}>;


export type SearchGlobalMetadataByCidOrNameQuery = { __typename?: 'query_root', metadata: Array<{ __typename?: 'metadata', name?: string | null, type?: any | null, size?: any | null, cid: string }> };

export type SearchUserMetadataByCidOrNameQueryVariables = Exact<{
  search: Scalars['String']['input'];
  oauthUserId: Scalars['String']['input'];
  oauthProvider: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
}>;


export type SearchUserMetadataByCidOrNameQuery = { __typename?: 'query_root', metadata: Array<{ __typename?: 'metadata', name?: string | null, type?: any | null, size?: any | null, cid: string }> };


export const FilesToBeReviewedDocument = gql`
    query FilesToBeReviewed($limit: Int!, $offset: Int!) {
  metadata_roots(
    where: {_and: [{tags: {_contains: ["reported"]}}, {_not: {tags: {_contains: ["banned"]}}}, {_not: {tags: {_contains: ["report-dismissed"]}}}]}
    limit: $limit
    offset: $offset
  ) {
    headCid: head_cid
  }
}
    `;

/**
 * __useFilesToBeReviewedQuery__
 *
 * To run a query within a React component, call `useFilesToBeReviewedQuery` and pass it any options that fit your needs.
 * When your component renders, `useFilesToBeReviewedQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useFilesToBeReviewedQuery({
 *   variables: {
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *   },
 * });
 */
export function useFilesToBeReviewedQuery(baseOptions: Apollo.QueryHookOptions<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables> & ({ variables: FilesToBeReviewedQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables>(FilesToBeReviewedDocument, options);
      }
export function useFilesToBeReviewedLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables>(FilesToBeReviewedDocument, options);
        }
export function useFilesToBeReviewedSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables>(FilesToBeReviewedDocument, options);
        }
export type FilesToBeReviewedQueryHookResult = ReturnType<typeof useFilesToBeReviewedQuery>;
export type FilesToBeReviewedLazyQueryHookResult = ReturnType<typeof useFilesToBeReviewedLazyQuery>;
export type FilesToBeReviewedSuspenseQueryHookResult = ReturnType<typeof useFilesToBeReviewedSuspenseQuery>;
export type FilesToBeReviewedQueryResult = Apollo.QueryResult<FilesToBeReviewedQuery, FilesToBeReviewedQueryVariables>;
export const MyUndismissedAsyncDownloadsDocument = gql`
    query MyUndismissedAsyncDownloads {
  async_downloads(where: {_not: {status: {_eq: "dismissed"}}}) {
    id
    oauthProvider: oauth_provider
    oauthUserId: oauth_user_id
    cid
    status
    errorMessage: error_message
    fileSize: file_size
    downloadedBytes: downloaded_bytes
    createdAt: created_at
    updatedAt: updated_at
  }
}
    `;

/**
 * __useMyUndismissedAsyncDownloadsQuery__
 *
 * To run a query within a React component, call `useMyUndismissedAsyncDownloadsQuery` and pass it any options that fit your needs.
 * When your component renders, `useMyUndismissedAsyncDownloadsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useMyUndismissedAsyncDownloadsQuery({
 *   variables: {
 *   },
 * });
 */
export function useMyUndismissedAsyncDownloadsQuery(baseOptions?: Apollo.QueryHookOptions<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>(MyUndismissedAsyncDownloadsDocument, options);
      }
export function useMyUndismissedAsyncDownloadsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>(MyUndismissedAsyncDownloadsDocument, options);
        }
export function useMyUndismissedAsyncDownloadsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>(MyUndismissedAsyncDownloadsDocument, options);
        }
export type MyUndismissedAsyncDownloadsQueryHookResult = ReturnType<typeof useMyUndismissedAsyncDownloadsQuery>;
export type MyUndismissedAsyncDownloadsLazyQueryHookResult = ReturnType<typeof useMyUndismissedAsyncDownloadsLazyQuery>;
export type MyUndismissedAsyncDownloadsSuspenseQueryHookResult = ReturnType<typeof useMyUndismissedAsyncDownloadsSuspenseQuery>;
export type MyUndismissedAsyncDownloadsQueryResult = Apollo.QueryResult<MyUndismissedAsyncDownloadsQuery, MyUndismissedAsyncDownloadsQueryVariables>;
export const GetGlobalFilesDocument = gql`
    query GetGlobalFiles($aggregateLimit: Int!, $limit: Int!, $offset: Int!, $orderBy: [metadata_roots_order_by!], $search: String) {
  metadata_roots(
    where: {_or: [{head_cid: {_ilike: $search}}, {name: {_ilike: $search}}]}
    limit: $limit
    offset: $offset
    order_by: $orderBy
  ) {
    cid: head_cid
    tags
    type: metadata(path: "type")
    name: metadata(path: "name")
    mimeType: metadata(path: "mimeType")
    size: metadata(path: "totalSize")
    children: metadata(path: "children")
    createdAt: created_at
    inner_metadata {
      maximumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      minimumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      publishedNodes: nodes_aggregate(where: {block_published_on: {_is_null: false}}) {
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
        is_admin
        oauth_provider
        oauth_user_id
      }
    }
  }
  metadata_roots_aggregate(
    limit: $aggregateLimit
    where: {inner_metadata: {object_ownership: {is_admin: {_eq: true}}}, _or: [{head_cid: {_ilike: $search}}, {name: {_ilike: $search}}]}
  ) {
    aggregate {
      count
    }
  }
}
    `;

/**
 * __useGetGlobalFilesQuery__
 *
 * To run a query within a React component, call `useGetGlobalFilesQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetGlobalFilesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetGlobalFilesQuery({
 *   variables: {
 *      aggregateLimit: // value for 'aggregateLimit'
 *      limit: // value for 'limit'
 *      offset: // value for 'offset'
 *      orderBy: // value for 'orderBy'
 *      search: // value for 'search'
 *   },
 * });
 */
export function useGetGlobalFilesQuery(baseOptions: Apollo.QueryHookOptions<GetGlobalFilesQuery, GetGlobalFilesQueryVariables> & ({ variables: GetGlobalFilesQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetGlobalFilesQuery, GetGlobalFilesQueryVariables>(GetGlobalFilesDocument, options);
      }
export function useGetGlobalFilesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetGlobalFilesQuery, GetGlobalFilesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetGlobalFilesQuery, GetGlobalFilesQueryVariables>(GetGlobalFilesDocument, options);
        }
export function useGetGlobalFilesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GetGlobalFilesQuery, GetGlobalFilesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<GetGlobalFilesQuery, GetGlobalFilesQueryVariables>(GetGlobalFilesDocument, options);
        }
export type GetGlobalFilesQueryHookResult = ReturnType<typeof useGetGlobalFilesQuery>;
export type GetGlobalFilesLazyQueryHookResult = ReturnType<typeof useGetGlobalFilesLazyQuery>;
export type GetGlobalFilesSuspenseQueryHookResult = ReturnType<typeof useGetGlobalFilesSuspenseQuery>;
export type GetGlobalFilesQueryResult = Apollo.QueryResult<GetGlobalFilesQuery, GetGlobalFilesQueryVariables>;
export const GetSharedFilesDocument = gql`
    query GetSharedFiles($oauthUserId: String!, $oauthProvider: String!, $limit: Int!, $offset: Int!, $orderBy: [metadata_roots_order_by!], $aggregateLimit: Int!) {
  metadata_roots(
    where: {inner_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: true}, is_admin: {_eq: false}}}}}
    limit: $limit
    offset: $offset
    order_by: $orderBy
  ) {
    cid: head_cid
    tags
    type: metadata(path: "type")
    name: metadata(path: "name")
    mimeType: metadata(path: "mimeType")
    size: metadata(path: "totalSize")
    children: metadata(path: "children")
    createdAt: created_at
    inner_metadata {
      maximumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      minimumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      publishedNodes: nodes_aggregate(where: {block_published_on: {_is_null: false}}) {
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
        oauth_provider
        oauth_user_id
        is_admin
      }
    }
  }
  metadata_roots_aggregate(
    limit: $aggregateLimit
    where: {inner_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: true}, is_admin: {_eq: false}}}}}
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
 *      orderBy: // value for 'orderBy'
 *      aggregateLimit: // value for 'aggregateLimit'
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
    query GetTrashedFiles($oauthUserId: String!, $oauthProvider: String!, $limit: Int!, $offset: Int!, $orderBy: [metadata_roots_order_by!], $aggregateLimit: Int!) {
  metadata_roots(
    where: {inner_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: false}}}}}
    limit: $limit
    offset: $offset
    order_by: $orderBy
  ) {
    cid: head_cid
    tags
    type: metadata(path: "type")
    name: metadata(path: "name")
    mimeType: metadata(path: "mimeType")
    size: metadata(path: "totalSize")
    children: metadata(path: "children")
    created_at
    inner_metadata {
      published_objects {
        id
      }
      maximumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      minimumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      publishedNodes: nodes_aggregate(where: {block_published_on: {_is_null: false}}) {
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
        oauth_provider
        oauth_user_id
        is_admin
      }
    }
  }
  metadata_roots_aggregate(
    limit: $aggregateLimit
    where: {inner_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, marked_as_deleted: {_is_null: false}}}}}
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
 *      orderBy: // value for 'orderBy'
 *      aggregateLimit: // value for 'aggregateLimit'
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
    query GetMyFiles($oauthUserId: String!, $oauthProvider: String!, $limit: Int!, $offset: Int!, $orderBy: [metadata_roots_order_by!], $search: String!, $aggregateLimit: Int!) {
  metadata_roots(
    where: {inner_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, is_admin: {_eq: true}, marked_as_deleted: {_is_null: true}}}}, _or: [{head_cid: {_ilike: $search}}, {name: {_ilike: $search}}]}
    limit: $limit
    offset: $offset
    order_by: $orderBy
  ) {
    cid: head_cid
    tags
    type: metadata(path: "type")
    name: metadata(path: "name")
    mimeType: metadata(path: "mimeType")
    size: metadata(path: "totalSize")
    children: metadata(path: "children")
    created_at
    inner_metadata {
      published_objects {
        id
      }
      maximumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      minimumBlockDepth: nodes(
        order_by: {block_published_on: desc_nulls_last}
        limit: 1
      ) {
        block_published_on
        tx_published_on
      }
      publishedNodes: nodes_aggregate(where: {block_published_on: {_is_null: false}}) {
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
        oauth_provider
        oauth_user_id
        is_admin
      }
    }
  }
  metadata_roots_aggregate(
    limit: $aggregateLimit
    where: {inner_metadata: {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}, is_admin: {_eq: true}, marked_as_deleted: {_is_null: true}}}, _or: [{head_cid: {_ilike: $search}}, {name: {_ilike: $search}}]}}
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
 *      orderBy: // value for 'orderBy'
 *      search: // value for 'search'
 *      aggregateLimit: // value for 'aggregateLimit'
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
export const GetMetadataByHeadCidDocument = gql`
    query GetMetadataByHeadCID($headCid: String!) {
  metadata(
    where: {_or: [{head_cid: {_ilike: $headCid}}, {name: {_ilike: $headCid}}]}
  ) {
    head_cid
    tags
    metadata
    created_at
    published_objects {
      id
    }
    maximumBlockDepth: nodes(
      order_by: {block_published_on: desc_nulls_last}
      limit: 1
    ) {
      block_published_on
      tx_published_on
    }
    minimumBlockDepth: nodes(
      order_by: {block_published_on: desc_nulls_last}
      limit: 1
    ) {
      block_published_on
      tx_published_on
    }
    publishedNodes: nodes_aggregate(where: {block_published_on: {_is_null: false}}) {
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
      oauth_user_id
      oauth_provider
      is_admin
    }
  }
}
    `;

/**
 * __useGetMetadataByHeadCidQuery__
 *
 * To run a query within a React component, call `useGetMetadataByHeadCidQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetMetadataByHeadCidQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetMetadataByHeadCidQuery({
 *   variables: {
 *      headCid: // value for 'headCid'
 *   },
 * });
 */
export function useGetMetadataByHeadCidQuery(baseOptions: Apollo.QueryHookOptions<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables> & ({ variables: GetMetadataByHeadCidQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables>(GetMetadataByHeadCidDocument, options);
      }
export function useGetMetadataByHeadCidLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables>(GetMetadataByHeadCidDocument, options);
        }
export function useGetMetadataByHeadCidSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables>(GetMetadataByHeadCidDocument, options);
        }
export type GetMetadataByHeadCidQueryHookResult = ReturnType<typeof useGetMetadataByHeadCidQuery>;
export type GetMetadataByHeadCidLazyQueryHookResult = ReturnType<typeof useGetMetadataByHeadCidLazyQuery>;
export type GetMetadataByHeadCidSuspenseQueryHookResult = ReturnType<typeof useGetMetadataByHeadCidSuspenseQuery>;
export type GetMetadataByHeadCidQueryResult = Apollo.QueryResult<GetMetadataByHeadCidQuery, GetMetadataByHeadCidQueryVariables>;
export const SearchGlobalMetadataByCidOrNameDocument = gql`
    query SearchGlobalMetadataByCIDOrName($search: String!, $limit: Int!) {
  metadata(
    distinct_on: root_cid
    where: {_or: [{head_cid: {_ilike: $search}}, {name: {_ilike: $search}}]}
    limit: $limit
  ) {
    type: metadata(path: "type")
    name
    size: metadata(path: "totalSize")
    cid: head_cid
  }
}
    `;

/**
 * __useSearchGlobalMetadataByCidOrNameQuery__
 *
 * To run a query within a React component, call `useSearchGlobalMetadataByCidOrNameQuery` and pass it any options that fit your needs.
 * When your component renders, `useSearchGlobalMetadataByCidOrNameQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useSearchGlobalMetadataByCidOrNameQuery({
 *   variables: {
 *      search: // value for 'search'
 *      limit: // value for 'limit'
 *   },
 * });
 */
export function useSearchGlobalMetadataByCidOrNameQuery(baseOptions: Apollo.QueryHookOptions<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables> & ({ variables: SearchGlobalMetadataByCidOrNameQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables>(SearchGlobalMetadataByCidOrNameDocument, options);
      }
export function useSearchGlobalMetadataByCidOrNameLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables>(SearchGlobalMetadataByCidOrNameDocument, options);
        }
export function useSearchGlobalMetadataByCidOrNameSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables>(SearchGlobalMetadataByCidOrNameDocument, options);
        }
export type SearchGlobalMetadataByCidOrNameQueryHookResult = ReturnType<typeof useSearchGlobalMetadataByCidOrNameQuery>;
export type SearchGlobalMetadataByCidOrNameLazyQueryHookResult = ReturnType<typeof useSearchGlobalMetadataByCidOrNameLazyQuery>;
export type SearchGlobalMetadataByCidOrNameSuspenseQueryHookResult = ReturnType<typeof useSearchGlobalMetadataByCidOrNameSuspenseQuery>;
export type SearchGlobalMetadataByCidOrNameQueryResult = Apollo.QueryResult<SearchGlobalMetadataByCidOrNameQuery, SearchGlobalMetadataByCidOrNameQueryVariables>;
export const SearchUserMetadataByCidOrNameDocument = gql`
    query SearchUserMetadataByCIDOrName($search: String!, $oauthUserId: String!, $oauthProvider: String!, $limit: Int!) {
  metadata(
    distinct_on: root_cid
    where: {_and: [{_or: [{head_cid: {_ilike: $search}}, {name: {_ilike: $search}}]}, {object_ownership: {_and: {oauth_user_id: {_eq: $oauthUserId}, oauth_provider: {_eq: $oauthProvider}}}}]}
    limit: $limit
  ) {
    type: metadata(path: "type")
    name
    size: metadata(path: "totalSize")
    cid: head_cid
  }
}
    `;

/**
 * __useSearchUserMetadataByCidOrNameQuery__
 *
 * To run a query within a React component, call `useSearchUserMetadataByCidOrNameQuery` and pass it any options that fit your needs.
 * When your component renders, `useSearchUserMetadataByCidOrNameQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useSearchUserMetadataByCidOrNameQuery({
 *   variables: {
 *      search: // value for 'search'
 *      oauthUserId: // value for 'oauthUserId'
 *      oauthProvider: // value for 'oauthProvider'
 *      limit: // value for 'limit'
 *   },
 * });
 */
export function useSearchUserMetadataByCidOrNameQuery(baseOptions: Apollo.QueryHookOptions<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables> & ({ variables: SearchUserMetadataByCidOrNameQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables>(SearchUserMetadataByCidOrNameDocument, options);
      }
export function useSearchUserMetadataByCidOrNameLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables>(SearchUserMetadataByCidOrNameDocument, options);
        }
export function useSearchUserMetadataByCidOrNameSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables>(SearchUserMetadataByCidOrNameDocument, options);
        }
export type SearchUserMetadataByCidOrNameQueryHookResult = ReturnType<typeof useSearchUserMetadataByCidOrNameQuery>;
export type SearchUserMetadataByCidOrNameLazyQueryHookResult = ReturnType<typeof useSearchUserMetadataByCidOrNameLazyQuery>;
export type SearchUserMetadataByCidOrNameSuspenseQueryHookResult = ReturnType<typeof useSearchUserMetadataByCidOrNameSuspenseQuery>;
export type SearchUserMetadataByCidOrNameQueryResult = Apollo.QueryResult<SearchUserMetadataByCidOrNameQuery, SearchUserMetadataByCidOrNameQueryVariables>;