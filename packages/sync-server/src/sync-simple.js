import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { merkle, SyncProtoBuf, Timestamp } from '@actual-app/crdt';

import { openDatabase } from './db';
import { config, sqlDir } from './load-config';
import { getPathForGroupFile } from './util/paths';

async function getGroupDb(groupId) {
  const dbType = process.env.ACTUAL_DATABASE_TYPE || config.get('databaseType') || 'sqlite';

  if (dbType === 'postgres') {
    // For Postgres, we use the global account database settings but it returns a PostgresDatabase instance
    // that internally uses the same pool.
    return openDatabase(':memory:'); // Path doesn't matter for Postgres in our shim
  }

  const path = getPathForGroupFile(groupId);
  const needsInit = !existsSync(path);

  const db = openDatabase(path);

  if (needsInit) {
    const sql = readFileSync(join(sqlDir, 'messages.sql'), 'utf8');
    await db.exec(sql);
  }

  return db;
}

async function addMessages(db, messages, groupId) {
  const dbType = process.env.ACTUAL_DATABASE_TYPE || config.get('databaseType') || 'sqlite';
  let trie = await getMerkle(db, groupId);

  if (messages.length > 0) {
    for (const msg of messages) {
      let info;
      if (dbType === 'postgres') {
        info = await db.mutate(
          `INSERT INTO messages_binary (group_id, timestamp, is_encrypted, content)
           VALUES (?, ?, ?, ?) ON CONFLICT (group_id, timestamp) DO NOTHING`,
          [
            groupId,
            msg.getTimestamp(),
            msg.getIsencrypted() ? 1 : 0,
            Buffer.from(msg.getContent()),
          ],
        );
      } else {
        info = await db.mutate(
          `INSERT OR IGNORE INTO messages_binary (timestamp, is_encrypted, content)
             VALUES (?, ?, ?)`,
          [
            msg.getTimestamp(),
            msg.getIsencrypted() ? 1 : 0,
            Buffer.from(msg.getContent()),
          ],
        );
      }

      if (info.changes > 0) {
        trie = merkle.insert(trie, Timestamp.parse(msg.getTimestamp()));
      }
    }
  }

  trie = merkle.prune(trie);

  if (dbType === 'postgres') {
    await db.mutate(
      'INSERT INTO messages_merkles (group_id, merkle) VALUES (?, ?) ON CONFLICT (group_id) DO UPDATE SET merkle = ?',
      [groupId, JSON.stringify(trie), JSON.stringify(trie)],
    );
  } else {
    await db.mutate(
      'INSERT INTO messages_merkles (id, merkle) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET merkle = ?',
      [JSON.stringify(trie), JSON.stringify(trie)],
    );
  }

  return trie;
}

async function getMerkle(db, groupId) {
  const dbType = process.env.ACTUAL_DATABASE_TYPE || config.get('databaseType') || 'sqlite';
  let rows;
  if (dbType === 'postgres') {
    rows = await db.all('SELECT * FROM messages_merkles WHERE group_id = ?', [groupId]);
  } else {
    rows = await db.all('SELECT * FROM messages_merkles');
  }

  if (rows.length > 0) {
    return JSON.parse(rows[0].merkle);
  } else {
    return {};
  }
}

export async function sync(messages, since, groupId) {
  const db = await getGroupDb(groupId);
  const dbType = process.env.ACTUAL_DATABASE_TYPE || config.get('databaseType') || 'sqlite';

  let newMessagesRows;
  if (dbType === 'postgres') {
    newMessagesRows = await db.all(
      `SELECT * FROM messages_binary
           WHERE group_id = ? AND timestamp > ?
           ORDER BY timestamp`,
      [groupId, since],
    );
  } else {
    newMessagesRows = await db.all(
      `SELECT * FROM messages_binary
           WHERE timestamp > ?
           ORDER BY timestamp`,
      [since],
    );
  }

  const trie = await addMessages(db, messages, groupId);

  await db.close();

  return {
    trie,
    newMessages: newMessagesRows.map(msg => {
      const envelopePb = new SyncProtoBuf.MessageEnvelope();
      envelopePb.setTimestamp(msg.timestamp);
      envelopePb.setIsencrypted(msg.is_encrypted);
      envelopePb.setContent(msg.content);
      return envelopePb;
    }),
  };
}
