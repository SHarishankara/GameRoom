// routes/game.js
// Original routes unchanged. New additions:
//   GET /api/game/profile/:username  — public player profile (Feature 4)
//   GET /api/game/leaderboard        — top 20 by ELO (Feature 4)
//   GET /api/game/queue-size         — matchmaking queue count (Feature 5, commented out)

const express             = require("express");
const router              = express.Router();
const { v4: uuidv4 }      = require("uuid");
const Game                = require("../models/Game");
const User                = require("../models/User");
const { protect }         = require("../middleware/auth");

// Feature 5: Uncomment when matchmaking is enabled
// const { getQueueSize } = require("../socket/matchmaking");

// ── POST /api/game/create-room (unchanged) ────────────────────
router.post("/create-room", protect, async (req, res) => {
  try {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    const game   = await Game.create({
      roomId,
      whitePlayer: { userId: req.user._id, username: req.user.username },
      status: "waiting",
    });
    res.status(201).json({
      message: "Room created! Share the room code with your friend.",
      roomId: game.roomId,
      shareLink: `${process.env.CLIENT_URL}/chess/${game.roomId}`,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── GET /api/game/room/:roomId (unchanged) ────────────────────
router.get("/room/:roomId", async (req, res) => {
  try {
    const game = await Game.findOne({ roomId: req.params.roomId });
    if (!game) return res.status(404).json({ message: "Room not found" });
    res.json({
      roomId:         game.roomId,
      status:         game.status,
      whitePlayer:    game.whitePlayer,
      blackPlayer:    game.blackPlayer,
      spectatorCount: game.spectators.length,
      currentFen:     game.currentFen,
      moveCount:      game.moves.length,
      winner:         game.winner,
      endReason:      game.endReason,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── GET /api/game/history (unchanged) ─────────────────────────
router.get("/history", protect, async (req, res) => {
  try {
    const games = await Game.find({
      status: "finished",
      $or: [
        { "whitePlayer.userId": req.user._id },
        { "blackPlayer.userId": req.user._id },
      ],
    }).sort({ updatedAt: -1 }).limit(20);
    res.json({ games });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── GET /api/game/queue-size — Feature 5 (matchmaking) ────────
// Uncomment when matchmaking is enabled.
// router.get("/queue-size", (req, res) => {
//   res.json({ size: getQueueSize() });
// });

// ── GET /api/game/profile/:username — Feature 4 ───────────────
// Public profile: username, ELO, wins, losses, gamesPlayed.
router.get("/profile/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select("username eloRating wins losses gamesPlayed avatar createdAt")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── GET /api/game/leaderboard — Feature 4 ─────────────────────
// Top 20 players by ELO. Only includes players with at least 1 game.
router.get("/leaderboard", async (req, res) => {
  try {
    const users = await User.find({ gamesPlayed: { $gte: 1 } })
      .sort({ eloRating: -1 })
      .limit(20)
      .select("username eloRating wins losses gamesPlayed")
      .lean();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;