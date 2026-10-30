async function findDriverById(driverId) {
  if (typeof driverId !== 'string' || !driverId) return null;
  try {
    const profile = await require('../services/mysqlDriverProfiles').getMysqlDriverProfiles().get(driverId);
    if (!profile) return null;
    const [first_name = '', ...lastParts] = (profile.name || '').split(/\s+/);
    return {first_name, last_name: lastParts.join(' ')};
  } catch (_) {
    console.error('MySQL driver profile lookup unavailable');
    return null;
  }
}

module.exports = {findDriverById};
