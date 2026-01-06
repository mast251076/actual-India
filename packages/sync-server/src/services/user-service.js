import { getAccountDb } from '../account-db';

export async function getUserByUsername(userName) {
  if (!userName || typeof userName !== 'string') {
    return null;
  }
  const { id } =
    (await getAccountDb().first('SELECT id FROM users WHERE user_name = ?', [
      userName,
    ])) || {};
  return id || null;
}

export async function getUserById(userId) {
  if (!userId) {
    return null;
  }
  const { id } =
    (await getAccountDb().first('SELECT * FROM users WHERE id = ?', [userId])) || {};
  return id || null;
}

export async function getFileById(fileId) {
  if (!fileId) {
    return null;
  }
  const { id } =
    (await getAccountDb().first('SELECT * FROM files WHERE files.id = ?', [fileId])) ||
    {};
  return id || null;
}

export function validateRole(roleId) {
  const possibleRoles = ['BASIC', 'ADMIN'];
  return possibleRoles.some(a => a === roleId);
}

export async function getOwnerCount() {
  const { ownerCount } = (await getAccountDb().first(
    `SELECT count(*) as ownerCount FROM users WHERE users.user_name <> '' and users.owner = 1`,
  )) || { ownerCount: 0 };
  return ownerCount;
}

export async function getOwnerId() {
  const { id } =
    (await getAccountDb().first(
      `SELECT users.id FROM users WHERE users.user_name <> '' and users.owner = 1`,
    )) || {};
  return id;
}

export async function getFileOwnerId(fileId) {
  const { owner } =
    (await getAccountDb().first(`SELECT files.owner FROM files WHERE files.id = ?`, [
      fileId,
    ])) || {};
  return owner;
}

export async function getAllUsers() {
  return getAccountDb().all(
    `SELECT users.id, user_name as userName, display_name as displayName, enabled, owner, role
     FROM users
     WHERE users.user_name <> ''`,
  );
}

export async function insertUser(userId, userName, displayName, enabled, role) {
  await getAccountDb().mutate(
    'INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES (?, ?, ?, ?, 0, ?)',
    [userId, userName, displayName, enabled, role],
  );
}

export async function updateUser(userId, userName, displayName, enabled) {
  if (!userId || !userName) {
    throw new Error('Invalid user parameters');
  }
  try {
    await getAccountDb().mutate(
      'UPDATE users SET user_name = ?, display_name = ?, enabled = ? WHERE id = ?',
      [userName, displayName, enabled, userId],
    );
  } catch (error) {
    throw new Error(`Failed to update user: ${error.message}`);
  }
}

export async function updateUserWithRole(
  userId,
  userName,
  displayName,
  enabled,
  roleId,
) {
  await getAccountDb().transaction(async () => {
    await getAccountDb().mutate(
      'UPDATE users SET user_name = ?, display_name = ?, enabled = ?, role = ? WHERE id = ?',
      [userName, displayName, enabled, roleId, userId],
    );
  });
}

export async function deleteUser(userId) {
  const res = await getAccountDb().mutate('DELETE FROM users WHERE id = ? and owner = 0', [
    userId,
  ]);
  return res.changes;
}

export async function deleteUserAccess(userId) {
  try {
    const res = await getAccountDb().mutate('DELETE FROM user_access WHERE user_id = ?', [
      userId,
    ]);
    return res.changes;
  } catch (error) {
    throw new Error(`Failed to delete user access: ${error.message}`);
  }
}

export async function transferAllFilesFromUser(ownerId, oldUserId) {
  if (!ownerId || !oldUserId) {
    throw new Error('Invalid user IDs');
  }
  try {
    await getAccountDb().transaction(async () => {
      const ownerExists = await getUserById(ownerId);
      if (!ownerExists) {
        throw new Error('New owner not found');
      }
      await getAccountDb().mutate('UPDATE files set owner = ? WHERE owner = ?', [
        ownerId,
        oldUserId,
      ]);
    });
  } catch (error) {
    throw new Error(`Failed to transfer files: ${error.message}`);
  }
}

export async function updateFileOwner(ownerId, fileId) {
  if (!ownerId || !fileId) {
    throw new Error('Invalid parameters');
  }
  try {
    const result = await getAccountDb().mutate(
      'UPDATE files set owner = ? WHERE id = ?',
      [ownerId, fileId],
    );
    if (result.changes === 0) {
      throw new Error('File not found');
    }
  } catch (error) {
    throw new Error(`Failed to update file owner: ${error.message}`);
  }
}

export async function getUserAccess(fileId, userId, isAdmin) {
  return getAccountDb().all(
    `SELECT users.id as userId, user_name as userName, files.owner, display_name as displayName
     FROM users
     JOIN user_access ON user_access.user_id = users.id
     JOIN files ON files.id = user_access.file_id
     WHERE files.id = ? and (files.owner = ? OR 1 = ?)`,
    [fileId, userId, isAdmin ? 1 : 0],
  );
}

export async function countUserAccess(fileId, userId) {
  const { accessCount } =
    (await getAccountDb().first(
      `SELECT COUNT(*) as accessCount
       FROM files
       WHERE files.id = ? AND (files.owner = ? OR EXISTS (
         SELECT 1 FROM user_access
         WHERE user_access.user_id = ? AND user_access.file_id = ?)
       )`,
      [fileId, userId, userId, fileId],
    )) || {};

  return accessCount || 0;
}

export async function checkFilePermission(fileId, userId) {
  return (
    (await getAccountDb().first(
      `SELECT 1 as granted
       FROM files
       WHERE files.id = ? and (files.owner = ?)`,
      [fileId, userId],
    )) || { granted: 0 }
  );
}

export async function addUserAccess(userId, fileId) {
  if (!userId || !fileId) {
    throw new Error('Invalid parameters');
  }
  try {
    const userExists = await getUserById(userId);
    const fileExists = await getFileById(fileId);
    if (!userExists || !fileExists) {
      throw new Error('User or file not found');
    }
    await getAccountDb().mutate(
      'INSERT INTO user_access (user_id, file_id) VALUES (?, ?)',
      [userId, fileId],
    );
  } catch (error) {
    if (error.message.includes('UNIQUE constraint') || error.message.includes('unique constraint')) {
      throw new Error('Access already exists');
    }
    throw new Error(`Failed to add user access: ${error.message}`);
  }
}

export async function deleteUserAccessByFileId(userIds, fileId) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error('The provided userIds must be a non-empty array.');
  }

  const CHUNK_SIZE = 999;
  let totalChanges = 0;

  try {
    await getAccountDb().transaction(async () => {
      for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');

        const sql = `DELETE FROM user_access WHERE user_id IN (${placeholders}) AND file_id = ?`;

        const result = await getAccountDb().mutate(sql, [...chunk, fileId]);
        totalChanges += result.changes;
      }
    });
  } catch (error) {
    throw new Error(`Failed to delete user access: ${error.message}`);
  }

  return totalChanges;
}

export async function getAllUserAccess(fileId) {
  //This can't be used here until we can create user invite links:
  //const isLoginMode = config.get('userCreationMode') === 'login';
  const isLoginMode = false;
  const joinType = isLoginMode ? 'JOIN' : 'LEFT JOIN';

  return getAccountDb().all(
    `
      SELECT
        users.id as userId,
        user_name     as userName,
        display_name  as displayName,
        CASE WHEN user_access.file_id IS NULL THEN 0 ELSE 1 END as haveAccess,
        CASE WHEN files.id IS NULL THEN 0 ELSE 1 END as owner
      FROM users
      ${joinType} user_access ON user_access.file_id = ? AND user_access.user_id = users.id
      ${joinType} files       ON files.id = ? AND files.owner = users.id
      WHERE users.enabled = 1
        AND users.user_name <> ''
    `,
    [fileId, fileId],
  );
}

export async function getOpenIDConfig() {
  return (
    (await getAccountDb().first(`SELECT * FROM auth WHERE method = ?`, ['openid'])) ||
    null
  );
}
