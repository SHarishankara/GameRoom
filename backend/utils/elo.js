// utils/elo.js — Standard ELO calculation (K=32)
// Used by: socket/chess.js (game end), socket/matchmaking.js

const K = 32; // How much a single game shifts the rating

/**
 * Calculate new ELO ratings after a game.
 * @param {number} whiteElo - White's current ELO
 * @param {number} blackElo - Black's current ELO
 * @param {string} winner   - "white" | "black" | "draw"
 * @returns {{ newWhite, newBlack, deltaWhite, deltaBlack }}
 */
function calcElo(whiteElo, blackElo, winner) {
  // Expected scores (probability of winning)
  const expectedWhite = 1 / (1 + Math.pow(10, (blackElo - whiteElo) / 400));
  const expectedBlack = 1 - expectedWhite;

  // Actual scores
  const actualWhite = winner === "white" ? 1 : winner === "draw" ? 0.5 : 0;
  const actualBlack = winner === "black" ? 1 : winner === "draw" ? 0.5 : 0;

  const newWhite = Math.round(whiteElo + K * (actualWhite - expectedWhite));
  const newBlack = Math.round(blackElo + K * (actualBlack - expectedBlack));

  return {
    newWhite,
    newBlack,
    deltaWhite: newWhite - whiteElo, // e.g. +14 or -18
    deltaBlack: newBlack - blackElo,
  };
}

module.exports = { calcElo };
