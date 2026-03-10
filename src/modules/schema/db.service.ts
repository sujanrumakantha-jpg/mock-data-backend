import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';

export interface DbConnectionParams {
    type: 'POSTGRES' | 'POSTGRESQL' | 'MYSQL';
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
}

export const DbService = {
    /**
     * Extracts schema metadata from a live database
     */
    async extractSchema(params: DbConnectionParams): Promise<string> {
        const type = params.type.toUpperCase();
        if (type === 'POSTGRES' || type === 'POSTGRESQL') {
            return this.extractPostgres(params);
        } else if (type === 'MYSQL') {
            return this.extractMysql(params);
        }
        throw new Error('Unsupported database type');
    },

    /**
     * PostgreSQL Schema Extraction
     */
    async extractPostgres(params: DbConnectionParams): Promise<string> {
        const isRemote = (params.host && !['localhost', '127.0.0.1'].includes(params.host)) || params.connectionString?.includes('.') && !params.connectionString?.includes('localhost');

        const clientConfig: any = {
            connectionString: params.connectionString,
            host: params.host,
            port: params.port,
            user: params.user,
            password: params.password,
            database: params.database,
            ssl: isRemote ? { rejectUnauthorized: false } : false
        };

        const client = new PgClient(clientConfig);

        try {
            await client.connect();

            // Query to get tables and columns
            const res = await client.query(`
                SELECT 
                    t.table_name,
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    c.column_default,
                    (SELECT count(*) FROM information_schema.table_constraints tc 
                     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
                     WHERE tc.table_name = t.table_name AND kcu.column_name = c.column_name AND tc.constraint_type = 'PRIMARY KEY') as is_primary
                FROM information_schema.tables t
                JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
                WHERE t.table_schema NOT IN ('information_schema', 'pg_catalog')
                AND t.table_type = 'BASE TABLE'
                ORDER BY t.table_schema, t.table_name, c.ordinal_position;
            `);

            // Query for Foreign Keys
            const fkRes = await client.query(`
                SELECT
                    tc.table_name, 
                    kcu.column_name, 
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name 
                FROM 
                    information_schema.table_constraints AS tc 
                    JOIN information_schema.key_column_usage AS kcu
                      ON tc.constraint_name = kcu.constraint_name
                      AND tc.table_schema = kcu.table_schema
                    JOIN information_schema.constraint_column_usage AS ccu
                      ON ccu.constraint_name = tc.constraint_name
                      AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY';
            `);

            return this.formatAsSql(res.rows, fkRes.rows, 'PostgreSQL');
        } finally {
            await client.end();
        }
    },

    /**
     * MySQL Schema Extraction
     */
    async extractMysql(params: DbConnectionParams): Promise<string> {
        const connection = await mysql.createConnection((params.connectionString || {
            host: params.host,
            port: params.port,
            user: params.user,
            password: params.password,
            database: params.database
        }) as any);

        try {
            const dbName = params.database || (connection.config as any).database;
            const [rows]: any = await connection.execute(`
                SELECT 
                    TABLE_NAME as table_name,
                    COLUMN_NAME as column_name,
                    DATA_TYPE as data_type,
                    IS_NULLABLE as is_nullable,
                    COLUMN_DEFAULT as column_default,
                    COLUMN_KEY as column_key
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = ?
                AND TABLE_NAME IN (SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = ?)
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            `, [dbName, dbName]);

            // Simple transformation of rows to match PG style for formatter
            const columns = rows.map((r: any) => ({
                ...r,
                is_primary: r.column_key === 'PRI' ? 1 : 0
            }));

            return this.formatAsSql(columns, [], 'MySQL'); // FKs simplified for now
        } finally {
            await connection.end();
        }
    },

    /**
     * Formats raw metadata into a readable SQL schema string
     */
    formatAsSql(columns: any[], foreignKeys: any[], type: string): string {
        const tables: Record<string, any[]> = {};
        columns.forEach(c => {
            if (!tables[c.table_name]) tables[c.table_name] = [];
            tables[c.table_name].push(c);
        });

        let sql = `-- Extracted from ${type} Database\n\n`;

        for (const [tableName, cols] of Object.entries(tables)) {
            sql += `CREATE TABLE ${tableName} (\n`;
            const colStrings = cols.map(c => {
                let s = `  ${c.column_name} ${c.data_type.toUpperCase()}`;
                if (c.is_primary == 1) s += ' PRIMARY KEY';
                if (c.is_nullable === 'NO') s += ' NOT NULL';
                return s;
            });

            // Add FKs if any
            const tableFks = foreignKeys.filter(fk => fk.table_name === tableName);
            tableFks.forEach(fk => {
                colStrings.push(`  FOREIGN KEY (${fk.column_name}) REFERENCES ${fk.foreign_table_name}(${fk.foreign_column_name})`);
            });

            sql += colStrings.join(',\n');
            sql += `\n);\n\n`;
        }

        return sql;
    }
};
