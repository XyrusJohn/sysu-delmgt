const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const backendDir = path.resolve(__dirname, '..');
const appRoot = path.resolve(backendDir, '..');
const localDir = path.join(backendDir, '.local-mysql');
const dataDir = path.join(localDir, 'data');
const configPath = path.join(localDir, 'my.ini');
const secretPath = path.join(localDir, 'runtime-secrets.json');
const setupCompletePath = path.join(localDir, 'bootstrap-complete');
const lockPath = path.join(localDir, 'bootstrap.lock');
const schemaPath = path.join(backendDir, 'src/migrations/mysql/001_auth_identity_schema.sql');
const usernameMigrationPath = path.join(backendDir, 'src/migrations/mysql/002_username_identity.sql');
const accountIdMigrationPath = path.join(backendDir, 'src/migrations/mysql/003_public_account_id.sql');
const port = 3307;
const host = '127.0.0.1';
const basedir = path.resolve(process.env.MYSQL_INSTALL_DIR || path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MySQL', 'MySQL Server 8.0'));
const mysqld = path.join(basedir, 'bin', 'mysqld.exe');
const readyTimeoutMs = 60000;

function fail(message) {
    throw new Error(message);
}

function writePrivateFile(filePath, contents) {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.writeFileSync(filePath, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
}

function writeManagedEnv(filePath, lines) {
    const content = `# Managed by local MySQL setup\n${Array.isArray(lines) ? lines.join('\n') : lines}\n`;
    if (fs.existsSync(filePath)) {
        if (!fs.readFileSync(filePath, 'utf8').startsWith('# Managed by local MySQL setup\n')) {
            fail(`Local environment file already exists at ${path.relative(appRoot, filePath)}; refusing to overwrite it.`);
        }
        fs.writeFileSync(filePath, content, {encoding: 'utf8', mode: 0o600});
    } else writePrivateFile(filePath, content);
}

function tcpListening() {
    return new Promise(resolve => {
        const socket = net.connect({host, port});
        socket.setTimeout(400);
        socket.once('connect', () => {socket.destroy(); resolve(true);});
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => {socket.destroy(); resolve(false);});
    });
}

function runMysql(args) {
    const executable = path.join(basedir, 'bin', 'mysql.exe');
    const result = spawnSync(executable, args, {encoding: 'utf8', windowsHide: true, timeout: 15000});
    if (result.error || result.status !== 0) fail(`MySQL local setup command failed (${result.error?.code || result.status || 'unknown'}).`);
    return result.stdout.trim();
}

async function waitForServer() {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
        if (!fs.existsSync(path.join(dataDir, 'mysql'))) fail('The isolated MySQL process exited before initialization completed; inspect its local error log.');
        if (await tcpListening()) return;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    fail('The isolated MySQL instance did not become ready within 60 seconds.');
}

async function performSetup() {
    if (os.platform() !== 'win32') fail('The local MySQL launcher currently supports Windows only.');
    if (!fs.existsSync(mysqld) || !fs.existsSync(path.join(basedir, 'bin', 'mysql.exe'))) {
        fail('MySQL Server 8.0 was not found. Set MYSQL_INSTALL_DIR to its installation directory.');
    }
    if (!fs.existsSync(schemaPath)) fail('The shared MySQL auth schema is missing.');
    if (!fs.existsSync(usernameMigrationPath)) fail('The username auth migration is missing.');
    if (!fs.existsSync(accountIdMigrationPath)) fail('The stable account ID migration is missing.');
    const existingSecrets = fs.existsSync(secretPath) ? JSON.parse(fs.readFileSync(secretPath, 'utf8')) : null;
    const envTargets = [path.join(backendDir, '.env'), path.resolve(backendDir, '../../sysu-go/backend/.env'), path.join(appRoot, 'frontend/.env')];
    for (const target of envTargets) {
        if (!fs.existsSync(target)) continue;
        if (!existingSecrets || !fs.readFileSync(target, 'utf8').startsWith('# Managed by local MySQL setup\n')) {
            fail(`Local environment file already exists at ${path.relative(appRoot, target)}; refusing to overwrite it.`);
        }
    }
    const alreadyListening = await tcpListening();
    if (alreadyListening) {
        if (!existingSecrets || !fs.existsSync(path.join(dataDir, 'mysql'))) fail('Port 3307 is already in use; the launcher will not attach to an unknown database process.');
        const localRootPassword = fs.existsSync(setupCompletePath) ? existingSecrets.rootPassword : '';
        const checkArgs = [`--host=${host}`, `--port=${port}`, '--protocol=TCP', '--user=root'];
        if (localRootPassword) checkArgs.push(`--password=${localRootPassword}`);
        checkArgs.push('--execute=SELECT 1');
        const check = spawnSync(path.join(basedir, 'bin', 'mysql.exe'), checkArgs, {encoding: 'utf8', windowsHide: true, timeout: 10000});
        if (check.error || check.status !== 0) fail('Port 3307 is occupied by an instance that does not match the stored isolated MySQL credentials.');
    }
    if (fs.existsSync(localDir)) {
        const owned = fs.existsSync(secretPath) && fs.existsSync(configPath) && fs.existsSync(path.join(localDir, 'launcher-owner'));
        const unexpectedEntries = fs.readdirSync(localDir).filter(name => name !== path.basename(lockPath));
        if (unexpectedEntries.length && !owned) fail('The dedicated MySQL directory exists without launcher ownership metadata; inspect it before continuing.');
    }
    if (!existingSecrets && envTargets.some(target => fs.existsSync(target))) {
        fail('Managed local environment files exist without local MySQL credentials; inspect them before continuing.');
    }
    fs.mkdirSync(localDir, {recursive: true});
    const initialized = fs.existsSync(path.join(dataDir, 'mysql'));

    const mysqlConfig = [
        '[mysqld]',
        `basedir=${basedir.replaceAll('\\', '/')}`,
        `datadir=${dataDir.replaceAll('\\', '/')}`,
        `port=${port}`,
        `bind-address=${host}`,
        `pid-file=${path.join(localDir, 'mysqld.pid').replaceAll('\\', '/')}`,
        `log-error=${path.join(localDir, 'mysqld.log').replaceAll('\\', '/')}`,
        'mysqlx=OFF',
        'max_connections=50',
        'innodb_buffer_pool_size=128M',
        'skip-log-bin',
        '',
    ].join('\n');
    if (fs.existsSync(configPath)) {
        const currentConfig = fs.readFileSync(configPath, 'utf8');
        if (currentConfig !== mysqlConfig) {
            if (alreadyListening) fail('The isolated MySQL config changed while its server is running; stop only that local instance and rerun setup.');
            fs.writeFileSync(configPath, mysqlConfig, {encoding: 'utf8', mode: 0o600});
        }
    } else writePrivateFile(configPath, mysqlConfig);
    if (!fs.existsSync(path.join(localDir, 'launcher-owner'))) {
        writePrivateFile(path.join(localDir, 'launcher-owner'), 'SYSU isolated local MySQL instance; port 3307; do not point at existing MySQL80 data.\n');
    }

    if (!initialized) {
        if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) {
            fail('The isolated MySQL data directory is not empty but has not been initialized; inspect it before continuing.');
        }
        fs.mkdirSync(dataDir, {recursive: true});
        const init = spawnSync(mysqld, [`--defaults-file=${configPath}`, '--initialize-insecure', '--console'], {
            encoding: 'utf8', windowsHide: true, timeout: 120000,
        });
        if (init.error || init.status !== 0) fail(`Isolated MySQL initialization failed (${init.error?.code || init.status || 'unknown'}).`);
    }

    let secrets;
    if (existingSecrets) {
        secrets = existingSecrets;
        if (secrets.port !== port || secrets.database !== 'sysu_local') fail('Stored local database settings do not match this isolated instance.');
    } else {
        if (initialized) fail('Local MySQL secrets are missing; refusing to guess credentials or change the existing instance.');
        secrets = {
            rootPassword: crypto.randomBytes(36).toString('base64url'),
            appPassword: crypto.randomBytes(36).toString('base64url'),
            goPassword: crypto.randomBytes(36).toString('base64url'),
            port,
            database: 'sysu_local',
        };
        fs.writeFileSync(secretPath, `${JSON.stringify(secrets, null, 2)}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    }

    if (!alreadyListening) {
        const child = spawn(mysqld, [`--defaults-file=${configPath}`, '--console'], {detached: true, stdio: 'ignore', windowsHide: true});
        child.unref();
        fs.writeFileSync(path.join(localDir, 'mysqld-launcher.pid'), `${child.pid}\n`, {encoding: 'utf8', mode: 0o600});
    }
    await waitForServer();

    const mysqlArgs = [`--host=${host}`, `--port=${port}`, '--protocol=TCP', '--user=root'];
    const rootArgs = fs.existsSync(setupCompletePath) ? [...mysqlArgs, `--password=${secrets.rootPassword}`] : mysqlArgs;
    runMysql([...rootArgs, '--execute=SELECT 1']);

    const [databaseRows] = runMysql([...rootArgs, '--batch', '--skip-column-names', '--execute=SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = \'sysu_local\'']).split(/\r?\n/).filter(Boolean);
    if (!databaseRows) {
        runMysql([...rootArgs, '--execute=CREATE DATABASE sysu_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci']);
    }
    const tableOutput = runMysql([...rootArgs, '--batch', '--skip-column-names', '--execute=SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = \'sysu_local\'']);
    const existingTables = tableOutput.split(/\r?\n/).filter(Boolean);
    const expected = ['app_auth_identities', 'app_auth_sessions', 'app_auth_users'];
    if (existingTables.length && (existingTables.length !== expected.length || expected.some(name => !existingTables.includes(name)))) {
        fail('The isolated local database contains an unexpected schema; refusing to apply migrations.');
    }
    if (!existingTables.length) {
        const mysql = require(path.join(backendDir, 'node_modules/mysql2/promise'));
        const rootPool = mysql.createPool({host, port, user: 'root', password: fs.existsSync(setupCompletePath) ? secrets.rootPassword : '', database: 'sysu_local', multipleStatements: true});
        try {
            await rootPool.query(fs.readFileSync(schemaPath, 'utf8'));
        } finally {
            await rootPool.end();
        }
    }

    const mysql = require(path.join(backendDir, 'node_modules/mysql2/promise'));
    const migrationPool = mysql.createPool({host, port, user: 'root', password: fs.existsSync(setupCompletePath) ? secrets.rootPassword : '', database: 'sysu_local', multipleStatements: true});
    try {
        const [columns] = await migrationPool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME IN ('username', 'username_normalized')");
        const present = new Set(columns.map(column => column.COLUMN_NAME));
        if (present.size === 0) await migrationPool.query(fs.readFileSync(usernameMigrationPath, 'utf8'));
        else if (present.size !== 2) fail('The username schema migration is partially present; refusing to guess how to repair it.');
        const [identityChecks] = await migrationPool.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_identities' AND CONSTRAINT_NAME = 'chk_app_auth_identity_provider' AND CONSTRAINT_TYPE = 'CHECK'");
        if (identityChecks.length !== 1) fail('The MySQL auth provider constraint is missing after migration.');
    } finally {
        await migrationPool.end();
    }

    const accountIdPool = mysql.createPool({host, port, user: 'root', password: fs.existsSync(setupCompletePath) ? secrets.rootPassword : '', database: 'sysu_local', multipleStatements: true});
    try {
        const [columns] = await accountIdPool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME = 'public_id'");
        if (columns.length === 0) await accountIdPool.query(fs.readFileSync(accountIdMigrationPath, 'utf8'));
        else if (columns.length !== 1) fail('The stable account ID migration is inconsistent.');
        const [indexes] = await accountIdPool.query("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND INDEX_NAME = 'uq_app_auth_users_public_id'");
        if (indexes.length === 0) fail('The stable account ID unique index is missing.');
    } finally {
        await accountIdPool.end();
    }

    const grantSql = `CREATE USER IF NOT EXISTS 'sysu_app'@'127.0.0.1' IDENTIFIED BY '${secrets.appPassword}'; CREATE USER IF NOT EXISTS 'sysu_go'@'127.0.0.1' IDENTIFIED BY '${secrets.goPassword}'; ALTER USER 'sysu_app'@'127.0.0.1' IDENTIFIED BY '${secrets.appPassword}'; ALTER USER 'sysu_go'@'127.0.0.1' IDENTIFIED BY '${secrets.goPassword}'; GRANT SELECT, INSERT, UPDATE, DELETE ON sysu_local.* TO 'sysu_app'@'127.0.0.1'; GRANT SELECT, INSERT, UPDATE, DELETE ON sysu_local.* TO 'sysu_go'@'127.0.0.1'; ALTER USER 'root'@'localhost' IDENTIFIED BY '${secrets.rootPassword}'`;
    runMysql([...rootArgs, `--execute=${grantSql}`]);
    if (!fs.existsSync(setupCompletePath)) writePrivateFile(setupCompletePath, 'Dedicated local auth schema and least-privilege users are initialized.\n');

    const shared = [
        'MYSQL_HOST=127.0.0.1', `MYSQL_PORT=${port}`, 'MYSQL_DATABASE=sysu_local',
        'AUTH_BACKEND=mysql',
    ];
    writeManagedEnv(path.join(backendDir, '.env'), [
        ...shared, 'MYSQL_USER=sysu_app', `MYSQL_PASSWORD=${secrets.appPassword}`,
        'PORT=3000', 'ALLOWED_ORIGINS=http://localhost:5173',
        '',
    ].join('\n'));
    writeManagedEnv(path.resolve(backendDir, '../../sysu-go/backend/.env'), [
        ...shared, 'MYSQL_USER=sysu_go', `MYSQL_PASSWORD=${secrets.goPassword}`,
        'PORT=3001', 'SYSU_ENV=local', '',
    ].join('\n'));
    writeManagedEnv(path.join(appRoot, 'frontend/.env'), [
        'VITE_RELEASE_TARGET=local', 'VITE_API_URL=http://localhost:3000',
        'VITE_SOCKET_URL=http://localhost:3000', 'VITE_DRIVER_TRACKING_URL=http://localhost:3001',
        '',
    ].join('\n'));
    process.stdout.write('Dedicated loopback MySQL is ready on 127.0.0.1:3307; local environment files were prepared without changing the existing MySQL80 service.\n');
}

async function main() {
    fs.mkdirSync(localDir, {recursive: true});
    let lockFd;
    try {
        lockFd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const deadline = Date.now() + 120000;
        while (fs.existsSync(lockPath) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (fs.existsSync(lockPath)) fail('Another local MySQL bootstrap did not finish within two minutes; inspect the local lock and error log.');
        return main();
    }
    try {
        await performSetup();
    } finally {
        fs.closeSync(lockFd);
        fs.unlinkSync(lockPath);
    }
}

main().catch(error => {
    process.stderr.write(`Local MySQL setup failed: ${error.message}\n`);
    process.exitCode = 1;
});
