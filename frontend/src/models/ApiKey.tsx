export type ApiKey = {
  id: string;
  secret: string;
  oauthProvider: string;
  oauthUserId: string;
  deletedAt?: Date | null;
  created_at: PropertyKey;
};

export type ApiKeyWithoutSecret = Omit<ApiKey, 'secret'> & {
  secret?: never;
};
