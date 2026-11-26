export const REQUIRED_VAULT_VARS = [
  'APP_DB_PASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_KID',
  'REFRESH_TOKEN_PEPPER',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
] as const;

export type VaultVarName = (typeof REQUIRED_VAULT_VARS)[number];
export type RuntimeSecrets = Record<VaultVarName, string>;

export function requireEnv(name: VaultVarName): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required vault secret environment variable: ${name}. ` +
        `Provide it via scripts/with-secrets.sh or export ${name} with SKIP_VAULT=1.`,
    );
  }
  return value;
}

export function loadRuntimeSecrets(): RuntimeSecrets {
  const secrets = {} as RuntimeSecrets;
  for (const name of REQUIRED_VAULT_VARS) {
    secrets[name] = requireEnv(name);
  }
  return secrets;
}
