const test = require('node:test');
const assert = require('node:assert/strict');
const {SEED, seedTruckCompanies} = require('../../scripts/seedTruckCompanies');

function createConnection() {
    const state = {rows: [], nextId: 2, committed: false, rolledBack: false, lockReleased: false};
    return {
        state,
        async execute(sql, values = []) {
            if (sql.includes('GET_LOCK')) return [[{acquired: 1}], []];
            if (sql.includes('RELEASE_LOCK')) {
                state.lockReleased = true;
                return [[{released: 1}], []];
            }
            if (sql.startsWith('SELECT id FROM app_truck_companies')) {
                return [state.rows.filter(row => row.forwarder_code === values[0]).slice(0, 1), []];
            }
            if (sql.startsWith('INSERT INTO app_truck_companies')) {
                const row = {id: state.nextId++, company_code: values[0], forwarder_code: values[1], name: values[2], active: true};
                state.rows.push(row);
                return [{insertId: row.id}, []];
            }
            if (sql.startsWith('UPDATE app_truck_companies SET company_code')) {
                const row = state.rows.find(item => item.id === values[1]);
                row.company_code = values[0];
                return [{affectedRows: 1}, []];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        async beginTransaction() {},
        async commit() {state.committed = true;},
        async rollback() {state.rolledBack = true;},
    };
}

test('local trucking-company seed is complete, idempotent, and keeps generated company codes numeric', async () => {
    const connection = createConnection();
    assert.equal(SEED.length, 51);
    const first = await seedTruckCompanies(connection);
    assert.deepEqual(first, {inserted: 51, alreadyPresent: 0});
    assert.equal(connection.state.rows.length, 51);
    assert.equal(connection.state.rows[0].company_code, '02');
    assert.equal(connection.state.rows[0].forwarder_code, '40000279');
    assert.equal(connection.state.rows[0].name, 'LALAMOVE PHILIPPINES INC');
    assert.equal(connection.state.rows[31].name, "CK'5 TRUCKING SERVICES");
    assert.equal(connection.state.rows[50].forwarder_code, '70000005');
    assert.equal(connection.state.committed, true);
    assert.equal(connection.state.lockReleased, true);

    connection.state.committed = false;
    const second = await seedTruckCompanies(connection);
    assert.deepEqual(second, {inserted: 0, alreadyPresent: 51});
    assert.equal(connection.state.rows.length, 51);
    assert.equal(connection.state.committed, true);
    assert.equal(connection.state.lockReleased, true);
});
