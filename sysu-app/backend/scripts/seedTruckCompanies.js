const {formatCompanyCode} = require('../src/utils/idGenerator');

const SEED = Object.freeze([
    ['40000279', 'LALAMOVE PHILIPPINES INC'],
    ['40001681', 'SCHENKER DISTRIBUTION SOLUTIONS,'],
    ['40001916', 'ZBZ GLOBAL LOGISTICS (PHILS) INC.'],
    ['50000001', '2GO LOGISTICS INC'],
    ['50000006', 'BCJ DELIVERY SERVICES'],
    ['50000013', 'DANIKO TRUCKING SERVICES'],
    ['50000016', 'EDMONTON TRUCKING SERVICES'],
    ['50000018', 'F. DRILON TRUCKING SERVICES'],
    ['50000019', 'F2 LOGISTICS PHILIPPINES INC'],
    ['50000020', 'F2 LOGISTICS PHILIPPINES INC.'],
    ['50000023', 'FAST LOGISTICS CORPORATION'],
    ['50000024', 'FAST LOGISTICS CORPORATION'],
    ['50000025', 'FASTCARGO LOGISTICS CORPORATION'],
    ['50000026', 'FAST LOGISTICS CORPORATION'],
    ['50000027', 'FAST LOGISTICS CORPORATION'],
    ['50000028', 'FAST LOGISTICS CORPORATION'],
    ['50000037', 'JONTHER CORPORATION'],
    ['50000039', 'KE ENTERPRISES'],
    ['50000040', 'KENJITSU TRANSPORTER CORPORATION'],
    ['50000043', 'LUBAY DELIVERY SERVICE'],
    ['50000047', 'METRO COMBINED LOGISTICS SOLUTIONS INC'],
    ['50000048', 'MISHABELA LOGISTICS SERVICES'],
    ['50000054', 'PHOEMIROLD TRANSPORT'],
    ['50000055', 'R.D. CASTILLO TRUCKING'],
    ['50000059', 'RL TRUCKING SERVICES'],
    ['50000066', 'TRITEK REVERSE LOGISTICS CORP.'],
    ['50000081', 'SAFEXPRESS LOGISTICS INC.'],
    ['50000090', 'RICARDO AND ANNIE TRUCKING'],
    ['50000091', 'SHIPA TRANSPORT'],
    ['50000093', 'MC3 CARMONA TRUCKING SERVICES'],
    ['50000095', 'DAPH TRUCKING SERVICES'],
    ['50000096', "CK'5 TRUCKING SERVICES"],
    ['50000101', 'GRAMORE TRUCKING SERVICES'],
    ['50000106', 'EXCELLENT FREIGHT INC.'],
    ['50000109', 'JUANCAT DELIVERY SERVICES'],
    ['50000111', 'VDS DELIVERY SERVICES'],
    ['50000119', 'ALOYSIANZ TRUCKING SERVICES'],
    ['50000120', "LITE EXPRESS INT'L INC"],
    ['50000122', 'RL1 TRUCKING SERVICES'],
    ['50000123', 'ST. CHRISTOPHER FORWARDERS OPC'],
    ['50000124', 'FASTLOGIC CORP.'],
    ['50000125', 'ROAR DELIVERY SERVICES'],
    ['50000126', 'MHETHZ TRUCKING SERVICES'],
    ['50000127', 'SHIASTINE LOGISTICS SERVICES'],
    ['50000128', 'J.H. CAROLINO DELIVERY SERVICES'],
    ['50000129', 'L3V LOGISTICS SERVICES'],
    ['50000130', 'DUSAU TRUCKING SERVICES'],
    ['50000131', 'QUINN&QUIAA TRUCKING SERVICES'],
    ['50000132', 'EZEKIEL DELIVERY SERVICES'],
    ['50000137', 'MSAU TRANSPORT SERVICES'],
    ['70000005', "WE'VELINK SERVICES INCORPORATED"],
].map(([forwarderCode, name]) => Object.freeze({forwarderCode, name})));

async function seedTruckCompanies(connection, companies = SEED) {
    const [[lock]] = await connection.execute(
        "SELECT GET_LOCK('sysu_local_truck_company_seed', 10) AS acquired",
    );
    if (Number(lock?.acquired) !== 1) throw new Error('Could not acquire local truck-company seed lock.');

    let started = false;
    let inserted = 0;
    let alreadyPresent = 0;
    try {
        await connection.beginTransaction();
        started = true;
        for (const {forwarderCode, name} of companies) {
            const [existing] = await connection.execute(
                'SELECT id FROM app_truck_companies WHERE forwarder_code = ? ORDER BY id ASC LIMIT 1 FOR UPDATE',
                [forwarderCode],
            );
            if (existing.length) {
                alreadyPresent++;
                continue;
            }

            const [result] = await connection.execute(
                'INSERT INTO app_truck_companies (company_code, forwarder_code, name, active) VALUES (?, ?, ?, TRUE)',
                [`seed-${forwarderCode}`, forwarderCode, name],
            );
            await connection.execute(
                'UPDATE app_truck_companies SET company_code = ? WHERE id = ?',
                [formatCompanyCode(Number(result.insertId)), result.insertId],
            );
            inserted++;
        }
        await connection.commit();
        started = false;
        return {inserted, alreadyPresent};
    } catch (error) {
        if (started) await connection.rollback();
        throw error;
    } finally {
        await connection.execute("SELECT RELEASE_LOCK('sysu_local_truck_company_seed')");
    }
}

module.exports = {SEED, seedTruckCompanies};
