// models/Game.js
const mongoose = require("mongoose");

const MoveSchema = new mongoose.Schema({
  from:     String,
  to:       String,
  piece:    String,
  san:      String,  // Standard Algebraic Notation e.g. "Nf3"
  fen:      String,  // Board state after this move
  playedAt: { type: Date, default: Date.now },
});

const GameSchema = new mongoose.Schema(
  {
    roomId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true, // fix #16 — fast lookup by roomId
    },

    whitePlayer: { userId: String, username: String },
    blackPlayer: { userId: String, username: String },

    spectators: [{ userId: String, username: String }],

    moves: [MoveSchema],

    currentFen: {
      type:    String,
      default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },

    status: {
      type:    String,
      enum:    ["waiting", "active", "finished"],
      default: "waiting",
    },

    winner: {
      type:    String,
      enum:    ["white", "black", "draw", null],
      default: null,
    },

    endReason: {
      type:    String,
      enum:    ["checkmate", "resignation", "draw", "timeout", null],
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);