import { join, resolve } from 'node:path';

import * as bcrypt from 'bcrypt';

import { bootstrapOpenId } from './accounts/openid';
import { bootstrapPassword, loginWithPassword } from './accounts/password';
import { openDatabase } from './db';
import { config } from './load-config';

let _accountDb;

export function getAccountDb() {
  if (_accountDb === undefined) {
    const dbPath = join(resolve(config.get('serverFiles')), 'account.sqlite');
    _accountDb = openDatabase(dbPath);
  }

  return _accountDb;
}

export async function needsBootstrap() {
  const accountDb = getAccountDb();
  const rows = await accountDb.all('SELECT * FROM auth');
  return rows.length === 0;
}

export async function listLoginMethods() {
  const accountDb = getAccountDb();
  const rows = await accountDb.all('SELECT method, display_name, active FROM auth');
  const availableMethods = rows
    .filter(f =>
      rows.length > 1 && config.get('enforceOpenId')
        ? f.method === 'openid'
        : true,
    )
    .map(r => ({
      method: r.method,
      active: r.active,
      displayName: r.display_name,
    }));
  return availableMethods;
}

export async function getActiveLoginMethod() {
  const accountDb = getAccountDb();
  const { method } =
    (await accountDb.first('SELECT method FROM auth WHERE active = 1')) || {};
  return method;
}

/*
 * Get the Login Method in the following order
 * req (the frontend can say which method in the case it wants to resort to forcing password auth)
 * config options
 * fall back to using password
 */
export async function getLoginMethod(req) {
  if (
    typeof req !== 'undefined' &&
    (req.body || { loginMethod: null }).loginMethod &&
    config.get('allowedLoginMethods').includes(req.body.loginMethod)
  ) {
    return req.body.loginMethod;
  }

  //BY-PASS ANY OTHER CONFIGURATION TO ENSURE HEADER AUTH
  if (
    config.get('loginMethod') === 'header' &&
    config.get('allowedLoginMethods').includes('header')
  ) {
    return config.get('loginMethod');
  }

  const activeMethod = await getActiveLoginMethod();
  return activeMethod || config.get('loginMethod');
}

export async function bootstrap(loginSettings, forced = false) {
  if (!loginSettings) {
    return { error: 'invalid-login-settings' };
  }
  const passEnabled = 'password' in loginSettings;
  const openIdEnabled = 'openId' in loginSettings;

  const accountDb = getAccountDb();
  await accountDb.mutate('BEGIN TRANSACTION');
  try {
    const { countOfOwner } =
      (await accountDb.first(
        `SELECT count(*) as countOfOwner
   FROM users
   WHERE users.user_name <> '' and users.owner = 1`,
      )) || {};

    if (!forced && (!openIdEnabled || countOfOwner > 0)) {
      if (!(await needsBootstrap())) {
        await accountDb.mutate('ROLLBACK');
        return { error: 'already-bootstrapped' };
      }
    }

    if (!passEnabled && !openIdEnabled) {
      await accountDb.mutate('ROLLBACK');
      return { error: 'no-auth-method-selected' };
    }

    if (passEnabled && openIdEnabled && !forced) {
      await accountDb.mutate('ROLLBACK');
      return { error: 'max-one-method-allowed' };
    }

    if (passEnabled) {
      const { error } = await bootstrapPassword(loginSettings.password);
      if (error) {
        await accountDb.mutate('ROLLBACK');
        return { error };
      }
    }

    if (openIdEnabled && forced) {
      const { error } = await bootstrapOpenId(loginSettings.openId);
      if (error) {
        await accountDb.mutate('ROLLBACK');
        return { error };
      }
    }

    await accountDb.mutate('COMMIT');
    return passEnabled ? await loginWithPassword(loginSettings.password) : {};
  } catch (error) {
    await accountDb.mutate('ROLLBACK');
    throw error;
  }
}

export async function isAdmin(userId) {
  return await hasPermission(userId, 'ADMIN');
}

export async function hasPermission(userId, permission) {
  const userPermission = await getUserPermission(userId);
  return userPermission === permission;
}

export async function enableOpenID(loginSettings) {
  if (!loginSettings || !loginSettings.openId) {
    return { error: 'invalid-login-settings' };
  }

  const { error } = (await bootstrapOpenId(loginSettings.openId)) || {};
  if (error) {
    return { error };
  }

  await getAccountDb().mutate('DELETE FROM sessions');
}

export async function disableOpenID(loginSettings) {
  if (!loginSettings || !loginSettings.password) {
    return { error: 'invalid-login-settings' };
  }

  const accountDb = getAccountDb();
  const { extra_data: passwordHash } =
    (await accountDb.first('SELECT extra_data FROM auth WHERE method = ?', [
      'password',
    ])) || {};

  if (!passwordHash) {
    return { error: 'invalid-password' };
  }

  if (!loginSettings?.password) {
    return { error: 'invalid-password' };
  }

  if (passwordHash) {
    const confirmed = bcrypt.compareSync(loginSettings.password, passwordHash);

    if (!confirmed) {
      return { error: 'invalid-password' };
    }
  }

  const { error } = (await bootstrapPassword(loginSettings.password)) || {};
  if (error) {
    return { error };
  }

  try {
    await accountDb.transaction(async () => {
      await accountDb.mutate('DELETE FROM sessions');
      await accountDb.mutate(
        `DELETE FROM user_access
                               WHERE user_access.user_id IN (
                                   SELECT users.id
                                   FROM users
                                   WHERE users.user_name <> ?
                               );`,
        [''],
      );
      await accountDb.mutate('DELETE FROM users WHERE user_name <> ?', ['']);
      await accountDb.mutate('DELETE FROM auth WHERE method = ?', ['openid']);
    });
  } catch (err) {
    console.error('Error cleaning up openid information:', err);
    return { error: 'database-error' };
  }
}

export async function getSession(token) {
  const accountDb = getAccountDb();
  return await accountDb.first('SELECT * FROM sessions WHERE token = ?', [token]);
}

export async function getUserInfo(userId) {
  const accountDb = getAccountDb();
  return await accountDb.first('SELECT * FROM users WHERE id = ?', [userId]);
}

export async function getUserPermission(userId) {
  const accountDb = getAccountDb();
  const { role } = (await accountDb.first(
    `SELECT role FROM users
          WHERE users.id = ?`,
    [userId],
  )) || { role: '' };

  return role;
}

export async function clearExpiredSessions() {
  const clearThreshold = Math.floor(Date.now() / 1000) - 3600;

  const deletedSessions = (await getAccountDb().mutate(
    'DELETE FROM sessions WHERE expires_at <> -1 and expires_at < ?',
    [clearThreshold],
  )).changes;

  console.log(`Deleted ${deletedSessions} old sessions`);
}
