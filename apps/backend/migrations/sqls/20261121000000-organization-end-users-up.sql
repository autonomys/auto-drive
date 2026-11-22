-- A partner organisation's end users: its customers, enrolled by the partner
-- through POST /organizations/:organizationId/end-users. The auth service
-- holds their identity (a wallet user with role end_user in the
-- organisation); this table holds what the partner gave for them. Removing an
-- end user sets removed_at, so the row stays for history and the address or
-- customer reference can be enrolled again.
CREATE TABLE public.organization_end_users (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  public_id text NOT NULL,
  -- EIP-55 checksummed.
  address text NOT NULL,
  -- The partner's reference for the customer, in the format of the
  -- X-Customer-Reference header.
  customer_reference text NOT NULL,
  -- NULL for the organisation's default quota.
  upload_quota_bytes bigint CHECK (upload_quota_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE UNIQUE INDEX organization_end_users_address_key
  ON public.organization_end_users (organization_id, address)
  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX organization_end_users_customer_reference_key
  ON public.organization_end_users (organization_id, customer_reference)
  WHERE removed_at IS NULL;
-- Paging through an organisation's end users.
CREATE INDEX organization_end_users_organization_id_created_at_idx
  ON public.organization_end_users (organization_id, created_at, id)
  WHERE removed_at IS NULL;
