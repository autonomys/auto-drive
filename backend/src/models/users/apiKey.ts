export type ApiKey = {
  id: string;
  secret: string;
  oauthProvider: string;
  oauthUserId: string;
  deletedAt: Date | null;
};

export type ApiKeyWithoutSecret = Omit<ApiKey, "secret"> & {
  secret?: never;
};
