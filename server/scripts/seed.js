"use strict";

const { loadConfig } = require("../src/config");
const { openDatabase, seedDatabase } = require("../src/db");
const { verifyLedger } = require("../src/ledger");

const config = loadConfig();
const db = openDatabase(config.dbPath);
const result = seedDatabase(db, config.ledgerSecret);
const ledger = verifyLedger(db, config.ledgerSecret);
db.close();

console.log(JSON.stringify({ ...result, ledger }, null, 2));
