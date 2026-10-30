// DEPRECATED — Auth routes are no longer mounted.
// Kept to prevent module-not-found errors if anything references this file.
// This legacy route is intentionally empty; clients use the MySQL session API.
const express = require("express");
const router = express.Router();

module.exports = router;
