const sanitizeName = (name) => {
  if (!name || name.trim().length === 0) return null;

  const clean = name.trim().replace(/\s+/g, " ").toLowerCase(); // Trim, collapse multiple spaces, and convert to lowercase

  return clean
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" "); // Capitalize the first letter of each word;
};

const sanitizePhoneNumber = (phone) => {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, ""); // Remove all non-digit characters
  return clean.length === 11 ? clean : null; // Return only if it's a valid 11-digit number
};

const sanitizeMiddleInitial = (mi) => {
  if (!mi) return null;

  const base = mi.trim().replace(/\./g, "");

  const clean = base.charAt(0).toUpperCase(); // Take the first character and capitalize

  if (/^[A-Z]$/.test(clean)) {
    return clean + "."; // Append a period to the middle initial
  }
  return null; // Return null if it's not a valid uppercase letter
};

const sanitizeUsername = (username) => {
  if (!username || username.trim().length === 0) return null;

  const clean = username.trim().toLowerCase();
  return clean;
};

module.exports = {
  sanitizeName,
  sanitizePhoneNumber,
  sanitizeMiddleInitial,
  sanitizeUsername,
};
