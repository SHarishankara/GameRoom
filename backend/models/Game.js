// models/Game.js — adds rematchRoomId for Feature 7 (Rematch)
const mongoose = require("mongoose");

const MoveSchema = new mongoose.Schema({
  from: String, to: String, piece: String,
  san: String, fen: String,
  playedAt: { type: Date, default: Date.now },
});

const GameSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },

    whitePlayer: { userId: String, username: String },
    blackPlayer:  { userId: String, username: String },
    spectators:   [{ userId: String, username: String }],
    moves:        [MoveSchema],

    currentFen: {
      type: String,
      default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },

    status: {
      type: String, enum: ["waiting", "active", "finished"], default: "waiting",
    },
    winner:    { type: String, enum: ["white", "black", "draw", null], default: null },
    endReason: { type: String, enum: ["checkmate", "resignation", "draw", "timeout", null], default: null },

    // ── Feature 7: Rematch ─────────────────────────────────
    // When both players want a rematch, this points to the new room.
    rematchRoomId: { type: String, default: null },
    // Tracks who has requested a rematch { white: bool, black: bool }
    rematchVotes:  { white: { type: Boolean, default: false }, black: { type: Boolean, default: false } },

    // ── Feature 4: ELO snapshot at game start ──────────────
    // Stored so ELO delta can be shown in game history even after ratings change
    eloAtStart: {
      white: { type: Number, default: null },
      black: { type: Number, default: null },
    },

    // ── Feature 5: Matchmaking flag ────────────────────────
    isMatchmade: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);