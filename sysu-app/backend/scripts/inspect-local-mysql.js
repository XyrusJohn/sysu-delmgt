const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({path: path.resolve(__dirname, '../.env')});

const {createMySqlPool} = require('../src/config/mysql');

async function main() {
    const pool = createMySqlPool();
    try {
        const [[server]] = await pool.query('SELECT DATABASE() AS databaseName, VERSION() AS version');
        const [tables] = await pool.query(`
            SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME
        `);
        const [columns] = await pool.query(`
            SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
                   IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `);
        process.stdout.write(`${JSON.stringify({server, tables, columns}, null, 2)}\n`);
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(`Local MySQL inspection failed (${error.code || 'CONFIGURATION_ERROR'}).`);
    process.exitCode = 1;
});
