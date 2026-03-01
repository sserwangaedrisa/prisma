const { setRequest } = require("../utils/request-context");
const { devPrisma, prodPrisma } = require("../utils/prismaClients");

function setRequestContext(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;

  const isLocal =
    ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.");

  const selectedPrisma = isLocal ? devPrisma : prodPrisma;
  const dbLabel = isLocal ? "DEV_DATABASE" : "PROD_DATABASE";

  console.log(`[DB SWITCH] IP: ${ip} => Using: ${dbLabel}`);

  setRequest(req, selectedPrisma, dbLabel);
  next();
}

module.exports = setRequestContext;
