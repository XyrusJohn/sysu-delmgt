const jwt = require("jsonwebtoken");

const generateToken = (user, res) => {
  const token = jwt.sign(
    { id: user.driver_id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }, // Token expires in 7 days
  );

  // 2. SET THE COOKIE (Dito mo ilalagay ang secure, httpOnly, at sameSite)
  const isProduction = process.env.NODE_ENV !== "development";

  res.cookie("token", token, {
    maxAge: 7 * 24 * 60 * 60 * 1000, // Cookie expires in 7 days
    httpOnly: true, // Cookie is only accessible via HTTP(S), not JavaScript
    secure: isProduction, // Cookie is only sent over HTTPS in production
    sameSite: "strict", // Cookie is only sent for same-site requests
  });
  return token;
};

module.exports = { generateToken };
