let instance;

function getMysqlAuthService({pool} = {}) {
  if (!instance) {
    const {createMysqlAuthService} = require('./mysqlAuthService');
    const {createMySqlPool} = require('../config/mysql');
    instance = createMysqlAuthService({
      pool: pool || createMySqlPool(),
    });
  }
  return instance;
}

module.exports = {getMysqlAuthService};
