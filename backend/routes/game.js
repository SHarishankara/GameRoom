const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const Game = require("../models/Game");
const { protect } = require("../middleware/auth");

// ── POST /api/game/create-room ─────────────────────────────
// Creates a new game room. The creator becomes White player.
// Requires: logged-in user (token in header)
router.post("/create-room", protect, async (req, res) => {
  try {
    // Generate a short 6-character room code (e.g. "a3f9b2")
    const roomId = uuidv4().slice(0, 6).toUpperCase();

    const game = await Game.create({
      roomId,
      whitePlayer: {
        userId: req.user._id,
        username: req.user.username,
      },
      status: "waiting", // Waiting for Black player to join
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

// ── GET /api/game/room/:roomId ─────────────────────────────
// Fetch room info (status, players, current board position)
router.get("/room/:roomId", async (req, res) => {
  try {
    const game = await Game.findOne({ roomId: req.params.roomId });

    if (!game) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.json({
      roomId: game.roomId,
      status: game.status,
      whitePlayer: game.whitePlayer,
      blackPlayer: game.blackPlayer,
      spectatorCount: game.spectators.length,
      currentFen: game.currentFen,
      moveCount: game.moves.length,
      winner: game.winner,
      endReason: game.endReason,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── GET /api/game/history ──────────────────────────────────
// Get all finished games for the logged-in user
router.get("/history", protect, async (req, res) => {
  try {
    const games = await Game.find({
      status: "finished",
      $or: [
        { "whitePlayer.userId": req.user._id },
        { "blackPlayer.userId": req.user._id },
      ],
    })
      .sort({ updatedAt: -1 }) // Newest first
      .limit(20);

    res.json({ games });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
