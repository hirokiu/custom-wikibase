const CONNECTION_CODES = new Set(['08001', '08003', '08006', '57P01', '57P02', '57P03', 'ECONNREFUSED', 'ECONNRESET']);

export function migrationErrorEvidence(error) {
  const value = /** @type {{code?: unknown, message?: unknown}} */ (error);
  const code = typeof value?.code === 'string' ? value.code : null;
  const message = typeof value?.message === 'string' ? value.message : String(error);
  let errorCode = 'JWB_MIGRATION_UNKNOWN_FAILED';
  if (CONNECTION_CODES.has(code ?? '')) errorCode = 'JWB_DB_CONNECTION_FAILED';
  else if (message.startsWith('MIGRATION_CHECKSUM_MISMATCH:')) errorCode = 'JWB_MIGRATION_CHECKSUM_MISMATCH';
  else if (code === '55P03') errorCode = 'JWB_MIGRATION_LOCK_FAILED';
  else if (code && /^[0-9A-Z]{5}$/u.test(code)) errorCode = 'JWB_MIGRATION_APPLY_FAILED';
  return Object.freeze({ errorCode, causeCode: code });
}
