export const WRITER_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function writerInvitationExpiry(row) {
  if (typeof row?.createdAt !== "string") return null;
  const createdAt = Date.parse(row.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  const maximum = createdAt + WRITER_INVITATION_TTL_MS;
  if (row.expiresAt === undefined) return maximum;
  if (typeof row.expiresAt !== "string") return null;
  const expiresAt = Date.parse(row.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > createdAt ? Math.min(expiresAt, maximum) : null;
}

export function isWriterInvitationActive(row, now = Date.now()) {
  const expiresAt = writerInvitationExpiry(row);
  const createdAt = typeof row?.createdAt === "string" ? Date.parse(row.createdAt) : NaN;
  return expiresAt !== null && createdAt <= now && now < expiresAt;
}
