const express = require("express");
const { protectRoute } = require("../middleware/protectRoute.js");

const router = express.Router();

router.get("/check", protectRoute, (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    return res.status(200).json({
      success: true,
      message: "Authentication successful",
      data: {
        user_id: req.user.uid,
      },
    });
  } catch (error) {
    console.error("CheckAuth error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server Error during authentication check",
    });
  }
});

module.exports = router;
