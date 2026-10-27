import { getDatabase } from '../../drivers/pg.js'

type Ownership = {
  cid: string
  oauth_provider: string
  oauth_user_id: string
  is_admin: boolean
  marked_as_deleted: Date | null
}

const setUserAsOwner = async (
  cid: string,
  provider: string,
  userId: string,
): Promise<void> => {
  const db = await getDatabase()

  await db.query<Ownership>({
    text: 'INSERT INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid, oauth_provider, oauth_user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin, marked_as_deleted = EXCLUDED.marked_as_deleted',
    values: [cid, provider, userId, false, null],
  })
}

const setUserAsAdmin = async (
  cid: string,
  provider: string,
  userId: string,
): Promise<void> => {
  const db = await getDatabase()

  await db.query<Ownership>({
    text: 'INSERT INTO object_ownership (cid, oauth_provider, oauth_user_id, is_admin, marked_as_deleted) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cid, oauth_provider, oauth_user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin, marked_as_deleted = EXCLUDED.marked_as_deleted',
    values: [cid, provider, userId, true, null],
  })
}

const updateDeletedAt = async (
  provider: string,
  userId: string,
  cid: string,
  markedAsDeleted: Date | null,
): Promise<void> => {
  const db = await getDatabase()

  await db.query({
    text: 'UPDATE object_ownership SET marked_as_deleted = $1 WHERE cid = $2 AND oauth_provider = $3 AND oauth_user_id = $4',
    values: [markedAsDeleted, cid, provider, userId],
  })
}

const getOwnerships = async (cid: string): Promise<Ownership[]> => {
  const db = await getDatabase()

  const result = await db.query<Ownership>({
    text: 'SELECT * FROM object_ownership WHERE cid = $1 AND marked_as_deleted IS NULL',
    values: [cid],
  })

  return result.rows
}

const getDeletedOwnerships = async (cid: string): Promise<Ownership[]> => {
  const db = await getDatabase()

  const result = await db.query<Ownership>({
    text: 'SELECT * FROM object_ownership WHERE cid = $1 AND marked_as_deleted IS NOT NULL',
    values: [cid],
  })

  return result.rows
}

const getAdmins = async (cid: string): Promise<Ownership[]> => {
  const db = await getDatabase()

  const result = await db.query<Ownership>({
    text: 'SELECT * FROM object_ownership WHERE cid = $1 AND is_admin = true',
    values: [cid],
  })

  return result.rows
}

/**
 * Returns how many admin (owner) ownerships exist for the root object(s) that
 * contain a cid and how many of them are still active (not marked as deleted).
 * Used to decide whether an object has been removed by its owner — see
 * ObjectUseCases.isObjectDeleted.
 *
 * Ownership/removal is tracked at the root-upload level: a folder root and a
 * standalone file each get an admin row keyed by their own cid, and removal
 * only marks that root row as deleted. Child files of a folder still carry
 * their own (vestigial) active admin rows from finalization, so we must NOT
 * inspect the requested cid's own ownership directly — that would keep a
 * trashed folder's children downloadable. Instead we resolve the cid to the
 * root object(s) referencing it (metadata.head_cid -> metadata.root_cid) and
 * evaluate admin ownership of those roots. A cid that no admin-owned root
 * references (e.g. an internal child node) yields zero admins and is never
 * treated as deleted, so legitimate access is unaffected. Deduplicated content
 * shared across several roots stays available as long as one such root remains
 * active.
 */
const getAdminOwnershipState = async (
  cid: string,
): Promise<{ totalAdmins: number; activeAdmins: number }> => {
  const db = await getDatabase()

  const result = await db.query<{
    total_admins: number
    active_admins: number
  }>({
    text: `SELECT
        COUNT(*) FILTER (WHERE oo.is_admin = true)::int AS total_admins,
        COUNT(*) FILTER (WHERE oo.is_admin = true AND oo.marked_as_deleted IS NULL)::int AS active_admins
      FROM object_ownership oo
      WHERE oo.cid IN (
        SELECT root_cid FROM metadata WHERE head_cid = $1
      )`,
    values: [cid],
  })

  const row = result.rows[0]
  return {
    totalAdmins: Number(row?.total_admins ?? 0),
    activeAdmins: Number(row?.active_admins ?? 0),
  }
}

/**
 * Builds a SQL boolean expression that is TRUE when the object identified by
 * `headCidExpr` is NOT removed by its owner, matching the semantics of
 * ObjectUseCases.isObjectDeleted / getAdminOwnershipState.
 *
 * Removal is tracked per root upload: a folder root (and a standalone file)
 * each get an admin ownership row keyed by their own cid, and removal only
 * marks that root row as deleted. Child files of a folder keep their own
 * (vestigial) active admin rows from finalization, so checking the object's
 * OWN cid ownership would wrongly keep a trashed folder's children visible.
 * Instead we resolve the head_cid to the root object(s) referencing it
 * (metadata.head_cid -> metadata.root_cid) and evaluate admin ownership of
 * those roots:
 *   - no admin ownership on any root  -> visible (bool_or over empty -> NULL,
 *     COALESCE to TRUE), e.g. internal/legacy nodes;
 *   - at least one root with an active admin owner -> visible;
 *   - admin owners exist but all are trashed -> hidden (removed).
 *
 * `headCidExpr` MUST be a trusted SQL column expression (e.g. 'metadata.head_cid'
 * or 'om.cid'), never user-provided input.
 */
const notRemovedByOwnerSQL = (headCidExpr: string): string => `COALESCE((
    SELECT bool_or(active_oo.marked_as_deleted IS NULL)
    FROM object_ownership active_oo
    WHERE active_oo.is_admin IS TRUE
      AND active_oo.cid IN (
        SELECT root_owner_meta.root_cid
        FROM metadata root_owner_meta
        WHERE root_owner_meta.head_cid = ${headCidExpr}
      )
  ), TRUE)`

export const ownershipRepository = {
  setUserAsOwner,
  setUserAsAdmin,
  updateDeletedAt,
  getOwnerships,
  getDeletedOwnerships,
  getAdmins,
  getAdminOwnershipState,
}

export const ownershipSQL = {
  notRemovedByOwnerSQL,
}
