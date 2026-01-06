import { join } from 'node:path';
import sqlite from 'better-sqlite3';
import pg from 'pg';
const { Pool } = pg;

import { config } from './load-config';

class SQLiteDatabase {
    constructor(dbPath) {
        this.db = new sqlite(dbPath);
    }

    async all(sql, params = []) {
        return this.db.prepare(sql).all(params);
    }

    async first(sql, params = []) {
        return this.db.prepare(sql).get(params);
    }

    async mutate(sql, params = []) {
        const res = this.db.prepare(sql).run(params);
        return {
            changes: res.changes,
            lastInsertRowid: res.lastInsertRowid,
        };
    }

    async exec(sql) {
        return this.db.exec(sql);
    }

    async transaction(fn) {
        const transaction = this.db.transaction(fn);
        return transaction();
    }

    async close() {
        this.db.close();
    }
}

class PostgresDatabase {
    constructor(url) {
        this.pool = new Pool({
            connectionString: url,
            ssl: url.includes('supabase.co') || url.includes('postgres.render.com')
                ? { rejectUnauthorized: false }
                : false,
        });
    }

    convertParams(sql) {
        let index = 1;
        return sql.replace(/\?/g, () => `$${index++}`);
    }

    async all(sql, params = []) {
        const pgSql = this.convertParams(sql);
        const res = await this.pool.query(pgSql, params);
        return res.rows;
    }

    async first(sql, params = []) {
        const pgSql = this.convertParams(sql);
        const res = await this.pool.query(pgSql, params);
        return res.rows[0];
    }

    async mutate(sql, params = []) {
        const pgSql = this.convertParams(sql);
        const res = await this.pool.query(pgSql, params);
        return {
            changes: res.rowCount,
            lastInsertRowid: null,
        };
    }

    async exec(sql) {
        return this.pool.query(sql);
    }

    async transaction(fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await fn();
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async close() {
        // No-op for pool
    }
}

export function openDatabase(dbPath) {
    const dbType = process.env.ACTUAL_DATABASE_TYPE || config.get('databaseType') || 'sqlite';
    const dbUrl = process.env.ACTUAL_DATABASE_URL || config.get('databaseUrl');

    if (dbType === 'postgres' && dbUrl) {
        return new PostgresDatabase(dbUrl);
    } else {
        return new SQLiteDatabase(dbPath);
    }
}
