const {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(scrypt);
const PASSWORD_N = 16384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_SALT = Buffer.alloc(16, 7);
const ROLES = new Set([
  "pending",
  "driver",
  "fleet_manager",
  "qr_generator",
  "admin",
  "super_admin",
]);
const STATUSES = new Set(["inactive", "active", "disabled"]);

class AuthError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function normalizeUsername(value) {
  if (typeof value !== "string") throw new AuthError("INVALID_USERNAME");
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username))
    throw new AuthError("INVALID_USERNAME");
  return username;
}

function validateProfile(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthError("INVALID_PROFILE");
  const profile = {};
  for (const field of [
    "fn",
    "mi",
    "ln",
    "name",
    "firstName",
    "middleName",
    "lastName",
    "phone",
    "position",
    "truckingCompany",
  ]) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || value[field].length > 100)
      throw new AuthError("INVALID_PROFILE");
    profile[field] = value[field].trim();
  }
  if (Buffer.byteLength(JSON.stringify(profile), "utf8") > 2048)
    throw new AuthError("INVALID_PROFILE");
  return profile;
}

function profileDisplayName(profile = {}) {
  const firstName = (profile.firstName || profile.fn || "").trim();
  const middleName = (profile.middleName || profile.mi || "").trim();
  const lastName = (profile.lastName || profile.ln || "").trim();
  if (firstName && lastName)
    return [firstName, middleName, lastName].filter(Boolean).join(" ");
  return typeof profile.name === "string" ? profile.name.trim() : "";
}

function requestedRegistrationRole(profile) {
  if (profile.position === "Admin") return "admin";
  if (profile.position === "Fleet Manager") return "fleet_manager";
  if (profile.position === "Driver" || profile.truckingCompany) return "driver";
  return null;
}

function publicUser(row) {
  if (
    !row ||
    typeof row.id === "undefined" ||
    typeof row.public_id !== "string" ||
    !ROLES.has(row.role) ||
    !STATUSES.has(row.status)
  ) {
    throw new AuthError("ACCOUNT_UNAVAILABLE", 403);
  }
  let profile = row.profile;
  if (typeof profile === "string") {
    try {
      profile = JSON.parse(profile);
    } catch {
      profile = {};
    }
  }
  const safeProfile =
    profile && typeof profile === "object" && !Array.isArray(profile)
      ? { ...profile }
      : {};
  delete safeProfile.email;
  delete safeProfile.emailVerified;
  const username = row.username || null;
  const storedName =
    typeof row.display_name === "string" ? row.display_name.trim() : "";
  const profileName = profileDisplayName(safeProfile);
  const displayName =
    storedName && storedName.toLowerCase() !== username?.toLowerCase()
      ? storedName
      : profileName || storedName;
  return {
    id: row.public_id,
    username,
    displayName,
    role: row.role,
    status: row.status,
    profile: safeProfile,
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, {
    N: PASSWORD_N,
    r: PASSWORD_R,
    p: PASSWORD_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== String(PASSWORD_N) ||
    parts[2] !== String(PASSWORD_R) ||
    parts[3] !== String(PASSWORD_P)
  ) {
    await scryptAsync(password, DUMMY_SALT, 64, {
      N: PASSWORD_N,
      r: PASSWORD_R,
      p: PASSWORD_P,
      maxmem: 64 * 1024 * 1024,
    });
    return false;
  }
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = Buffer.from(
      await scryptAsync(password, salt, expected.length, {
        N: PASSWORD_N,
        r: PASSWORD_R,
        p: PASSWORD_P,
        maxmem: 64 * 1024 * 1024,
      }),
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sessionDigest(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

function createMysqlAuthService({
  pool,
  now = () => Date.now(),
  tokenFactory = () => randomBytes(32).toString("base64url"),
}) {
  if (
    !pool ||
    typeof pool.execute !== "function" ||
    typeof pool.getConnection !== "function"
  ) {
    throw new TypeError("A MySQL-compatible pool is required");
  }

  async function issueSession(userId, executor = pool) {
    const token = tokenFactory();
    const expiresAt = new Date(now() + SESSION_TTL_MS);
    await executor.execute(
      "INSERT INTO app_auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
      [sessionDigest(token), userId, expiresAt],
    );
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async function transaction(operation, { mapDuplicate = true } = {}) {
    const connection = await pool.getConnection();
    let started = false;
    let discard = false;
    try {
      await connection.beginTransaction();
      started = true;
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      if (started) {
        try {
          await connection.rollback();
        } catch {
          discard = true;
        }
      }
      if (mapDuplicate && error.code === "ER_DUP_ENTRY")
        throw new AuthError("ACCOUNT_EXISTS", 409);
      throw error;
    } finally {
      if (discard) connection.destroy();
      else connection.release();
    }
  }

  async function registerWithUsername({
    username: rawUsername,
    password,
    displayName = "",
    profile: rawProfile = {},
  } = {}) {
    const username = normalizeUsername(rawUsername);
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    )
      throw new AuthError("INVALID_PASSWORD");
    if (typeof displayName !== "string" || displayName.trim().length > 100)
      throw new AuthError("INVALID_PROFILE");
    const profile = validateProfile(rawProfile);
    const requestedRole = requestedRegistrationRole(profile);
    if (requestedRole) profile.pendingRoleChange = requestedRole;
    const passwordHash = await hashPassword(password);
    const publicId = randomUUID();
    return transaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO app_auth_users (public_id, username, username_normalized, display_name, role, status, profile)
                 VALUES (?, ?, ?, ?, 'pending', 'inactive', ?)`,
        [
          publicId,
          rawUsername.trim(),
          username,
          displayName.trim(),
          JSON.stringify(profile),
        ],
      );
      await connection.execute(
        "INSERT INTO app_auth_identities (user_id, provider, provider_subject, password_hash) VALUES (?, 'username', ?, ?)",
        [result.insertId, username, passwordHash],
      );
      if (requestedRole) {
        await connection.execute(
          `INSERT INTO app_role_requests
                     (id, requester_id, requester_name, current_role, requested_role)
                     VALUES (?, ?, ?, 'pending', ?)`,
          [
            randomUUID(),
            publicId,
            displayName.trim() || profile.name || rawUsername.trim(),
            requestedRole,
          ],
        );
      }
      const user = publicUser({
        id: result.insertId,
        public_id: publicId,
        username: rawUsername.trim(),
        display_name: displayName.trim(),
        role: "pending",
        status: "inactive",
        profile,
      });
      return { user, ...(await issueSession(result.insertId, connection)) };
    });
  }

  async function loginWithUsername({ username: rawUsername, password } = {}) {
    const username = normalizeUsername(rawUsername);
    if (typeof password !== "string" || password.length > 128)
      throw new AuthError("INVALID_CREDENTIALS", 401);
    const [rows] = await pool.execute(
      `SELECT u.id, u.public_id, u.username, u.display_name, u.role, u.status, u.profile, i.password_hash
             FROM app_auth_users u JOIN app_auth_identities i ON i.user_id = u.id
             WHERE i.provider = 'username' AND i.provider_subject = ? LIMIT 1`,
      [username],
    );
    const row = rows[0];
    const validPassword = await verifyPassword(password, row?.password_hash);
    if (!row || !validPassword) throw new AuthError("INVALID_CREDENTIALS", 401);
    const user = publicUser(row);
    if (user.status === "disabled")
      throw new AuthError("ACCOUNT_DISABLED", 403);
    return { user, ...(await issueSession(row.id)) };
  }

  async function authenticate(token) {
    if (typeof token !== "string" || token.length < 40 || token.length > 128)
      return null;
    const [rows] = await pool.execute(
      `SELECT u.id, u.public_id, u.username, u.display_name, u.role, u.status, u.profile
             FROM app_auth_sessions s JOIN app_auth_users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`,
      [sessionDigest(token)],
    );
    if (!rows[0]) return null;
    const user = publicUser(rows[0]);
    return user.status === "disabled" ? null : user;
  }

  async function updateProfile(token, input = {}) {
    if (typeof token !== "string" || token.length < 40 || token.length > 128)
      throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !["displayName", "photoURL", "profile"].includes(key),
      )
    ) {
      throw new AuthError("INVALID_PROFILE");
    }
    const displayName = input.displayName;
    if (
      displayName !== undefined &&
      (typeof displayName !== "string" ||
        !displayName.trim() ||
        displayName.trim().length > 100)
    ) {
      throw new AuthError("INVALID_PROFILE");
    }
    if (
      input.photoURL !== undefined &&
      input.photoURL !== null &&
      input.photoURL !== ""
    ) {
      if (typeof input.photoURL !== "string" || input.photoURL.length > 2048)
        throw new AuthError("INVALID_PROFILE");
      let parsed;
      try {
        parsed = new URL(input.photoURL);
      } catch {
        throw new AuthError("INVALID_PROFILE");
      }
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new AuthError("INVALID_PROFILE");
    }
    const profilePatch =
      input.profile === undefined ? {} : validateProfile(input.profile);
    const hasStructuredName = ["firstName", "middleName", "lastName"].some(
      (field) => Object.hasOwn(profilePatch, field),
    );
    if (
      hasStructuredName &&
      (!profilePatch.firstName || !profilePatch.lastName)
    )
      throw new AuthError("INVALID_PROFILE");
    return transaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT u.id, u.public_id, u.username, u.display_name, u.role, u.status, u.profile
                 FROM app_auth_sessions s JOIN app_auth_users u ON u.id = s.user_id
                 WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
        [sessionDigest(token)],
      );
      const row = rows[0];
      if (!row || row.status === "disabled")
        throw new AuthError("AUTHENTICATION_REQUIRED", 401);
      let currentProfile = row.profile;
      if (typeof currentProfile === "string") {
        try {
          currentProfile = JSON.parse(currentProfile);
        } catch {
          currentProfile = {};
        }
      }
      const profile = { ...(currentProfile || {}), ...profilePatch };
      if (input.photoURL !== undefined)
        profile.photoURL = input.photoURL || null;
      const structuredName = profileDisplayName(profile);
      if (hasStructuredName) {
        profile.name = structuredName;
        profile.fn = profile.firstName;
        profile.mi = profile.middleName
          ? `${profile.middleName[0].toUpperCase()}.`
          : "";
        profile.ln = profile.lastName;
      }
      if (Buffer.byteLength(JSON.stringify(profile), "utf8") > 4096)
        throw new AuthError("INVALID_PROFILE");
      const name = hasStructuredName
        ? structuredName
        : displayName === undefined
          ? row.display_name
          : displayName.trim();
      await connection.execute(
        "UPDATE app_auth_users SET display_name = ?, profile = ? WHERE id = ?",
        [name, JSON.stringify(profile), row.id],
      );
      return { user: publicUser({ ...row, display_name: name, profile }) };
    });
  }

  async function logout(token) {
    if (typeof token !== "string" || token.length < 40 || token.length > 128)
      return false;
    const [result] = await pool.execute(
      "UPDATE app_auth_sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = ? AND revoked_at IS NULL",
      [sessionDigest(token)],
    );
    return result.affectedRows === 1;
  }

  return Object.freeze({
    registerWithUsername,
    loginWithUsername,
    authenticate,
    updateProfile,
    logout,
  });
}

module.exports = {
  AuthError,
  createMysqlAuthService,
  normalizeUsername,
  validateProfile,
};
