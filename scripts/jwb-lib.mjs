import { randomBytes } from 'node:crypto';

export const JWB_PROJECT = 'wfp-jwb-m1';
export const JWB_DOCKER_CONTEXT = 'desktop-linux';
export const JWB_STATE_FILE = '/tmp/wfp-jwb-m1-state.json';
export const JWB_BASE_URL = 'http://127.0.0.1:8180';

export function assertJwbDockerTarget({ context, operatingSystem, architecture }) {
  if (context !== JWB_DOCKER_CONTEXT || /utirik|prod|production/iu.test(context)) {
    throw new Error(`refusing Docker context: ${context}`);
  }
  if (operatingSystem !== 'linux' || architecture !== 'aarch64') {
    throw new Error(`M1 requires native Docker Desktop linux/aarch64, found ${operatingSystem}/${architecture}`);
  }
}

export function createJwbState() {
  return {
    version: 1,
    project: JWB_PROJECT,
    databaseName: 'japan_wikibase',
    databaseUser: 'jwb_app',
    databasePassword: randomBytes(36).toString('base64url'),
    databaseRootPassword: randomBytes(36).toString('base64url'),
    adminUser: 'JwbAdmin',
    adminPassword: randomBytes(36).toString('base64url'),
    secretKey: randomBytes(48).toString('base64url'),
    upgradeKey: randomBytes(24).toString('base64url'),
    persistentEntityId: null
  };
}

export function stateEnvironment(state) {
  if (state?.project !== JWB_PROJECT || state?.version !== 1) throw new Error('invalid M1 state identity');
  return {
    JWB_DB_NAME: state.databaseName,
    JWB_DB_USER: state.databaseUser,
    JWB_DB_PASSWORD: state.databasePassword,
    JWB_DB_ROOT_PASSWORD: state.databaseRootPassword,
    JWB_ADMIN_USER: state.adminUser,
    JWB_ADMIN_PASSWORD: state.adminPassword,
    JWB_SECRET_KEY: state.secretKey,
    JWB_UPGRADE_KEY: state.upgradeKey
  };
}
