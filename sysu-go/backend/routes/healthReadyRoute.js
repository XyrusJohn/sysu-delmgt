const CENTRAL_DATABASE = 'sysu_fleet_app';

function createDatabaseReadinessHandler({databaseName, probe, timeoutMs = 3000}) {
  if (typeof probe !== 'function') throw new TypeError('A database readiness probe is required');
  let pending;
  return async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!pending) pending = Promise.resolve().then(() => {
      if (databaseName !== CENTRAL_DATABASE) throw new Error('Central database is not configured');
      return probe();
    }).finally(() => {pending = null;});
    let timer;
    try {
      await Promise.race([pending, new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Database readiness timeout')), timeoutMs);
      })]);
      return res.json({status: 'ready', database: 'connected'});
    } catch {
      return res.status(503).json({status: 'not_ready', database: 'unavailable'});
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {CENTRAL_DATABASE, createDatabaseReadinessHandler};
