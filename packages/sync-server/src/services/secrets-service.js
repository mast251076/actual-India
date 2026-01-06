import createDebug from 'debug';

import { getAccountDb } from '../account-db';

/**
 * An enum of valid secret names.
 * @readonly
 * @enum {string}
 */
export const SecretName = {
  gocardless_secretId: 'gocardless_secretId',
  gocardless_secretKey: 'gocardless_secretKey',
  simplefin_token: 'simplefin_token',
  simplefin_accessKey: 'simplefin_accessKey',
  pluggyai_clientId: 'pluggyai_clientId',
  pluggyai_clientSecret: 'pluggyai_clientSecret',
  pluggyai_itemIds: 'pluggyai_itemIds',
};

class SecretsDb {
  constructor() {
    this.debug = createDebug('actual:secrets-db');
    this.db = null;
  }

  open() {
    return getAccountDb();
  }

  async set(name, value) {
    if (!this.db) {
      this.db = this.open();
    }

    this.debug(`setting secret '${name}' to '${value}'`);
    const result = await this.db.mutate(
      `INSERT INTO secrets (name, value) ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
      [name, value],
    );
    return result;
  }

  async get(name) {
    if (!this.db) {
      this.db = this.open();
    }

    this.debug(`getting secret '${name}'`);
    const result = await this.db.first(`SELECT value FROM secrets WHERE name =?`, [
      name,
    ]);
    return result;
  }
}

const secretsDb = new SecretsDb();
const _cachedSecrets = new Map();
/**
 * A service for managing secrets stored in `secretsDb`.
 */
export const secretsService = {
  /**
   * Retrieves the value of a secret by name.
   * @param {SecretName} name - The name of the secret to retrieve.
   * @returns {Promise<string|null>} The value of the secret, or null if the secret does not exist.
   */
  get: async name => {
    if (_cachedSecrets.has(name)) {
      return _cachedSecrets.get(name);
    }
    const res = await secretsDb.get(name);
    const value = res?.value ?? null;
    if (value) {
      _cachedSecrets.set(name, value);
    }
    return value;
  },

  /**
   * Sets the value of a secret by name.
   * @param {SecretName} name - The name of the secret to set.
   * @param {string} value - The value to set for the secret.
   * @returns {Promise<Object>}
   */
  set: async (name, value) => {
    const result = await secretsDb.set(name, value);

    if (result.changes === 1) {
      _cachedSecrets.set(name, value);
    }
    return result;
  },

  /**
   * Determines whether a secret with the given name exists.
   * @param {SecretName} name - The name of the secret to check for existence.
   * @returns {Promise<boolean>} True if a secret with the given name exists, false otherwise.
   */
  exists: async name => {
    return Boolean(await secretsService.get(name));
  },
};
