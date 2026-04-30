const mongoose = require("mongoose");

const MoveSchema = new mongoose.Schema({
  from: String,       // e.g. "e2"
  to: String,         // e.g. "e4"
  piece: String,      // e.g. "p" (pawn)
  fen: String,        // Board state after this move
  playedAt: { type: Date, default: Date.now },
});

const GameSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
    },

    // The two players
    whitePlayer: {
      userId: { type: String },
      username: String,
    },
    blackPlayer: {
      userId: { type: String },
      username: String,
    },

    // Spectators who joined
    spectators: [
      {
        userId: { type: String },
        username: String,
      },
    ],

    // Every move made in the game
    moves: [MoveSchema],

    // Current board state (FEN string)
    currentFen: {
      type: String,
      default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", // Starting position
    },

    // Game status
    status: {
      type: String,
      enum: ["waiting", "active", "finished"],
      default: "waiting",
    },

    // Who won? "white", "black", or "draw"
    winner: {
      type: String,
      enum: ["white", "black", "draw", null],
      default: null,
    },

    // How did it end?
    endReason: {
      type: String,
      enum: ["checkmate", "resignation", "draw", "timeout", null],
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Game", GameSchema);
