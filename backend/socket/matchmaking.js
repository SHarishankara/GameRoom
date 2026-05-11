// socket/matchmaking.js — Feature 5: Matchmaking Queue
// Keeps a queue of waiting players and pairs them by closest ELO.
// Registers its own socket events alongside chess.js handlers.

const { v4: uuidv4 } = require("uuid");
const Game = require("../models/Game");
const User = require("../models/User");

// In-memory queue: [{ userId, username, eloRating, socketId }]
const queue = [];

// Max ELO gap for a "close" match. If nobody is close, match anyone after 30s.
const ELO_THRESHOLD = 300;
const WAIT_TIMEOUT  = 30_000; // 30 seconds

// Timers tracking how long each user has been waiting { userId: timeoutHandle }
const waitTimers = {};

function registerMatchmaking(io) {
  io.on("connection", (socket) => {
    const { id: userId, username } = socket.user;

    // ── JOIN QUEUE ────────────────────────────────────────────
    socket.on("queue-join", async () => {
      // Prevent duplicate queue entries
      if (queue.find(u => u.userId === userId.toString())) {
        return socket.emit("queue-status", { status: "already-queued" });
      }

      // Fetch ELO from DB so it can't be spoofed
      const user = await User.findById(userId).select("eloRating").lean();
      const elo  = user?.eloRating ?? 1200;

      const entry = { userId: userId.toString(), username, eloRating: elo, socketId: socket.id };
      queue.push(entry);

      socket.emit("queue-status", { status: "queued", position: queue.length });
      console.log(`🎯 Queue: ${username} (${elo}) joined. Queue size: ${queue.length}`);

      // Try to find a match immediately
      const matched = tryMatch(entry);

      // If no match yet, set a fallback timer to match with ANYONE after 30s
      if (!matched) {
        waitTimers[userId.toString()] = setTimeout(() => {
          // Only match if user is still in queue
          const stillQueued = queue.find(u => u.userId === userId.toString());
          if (stillQueued) tryMatchAny(stillQueued);
        }, WAIT_TIMEOUT);
      }
    });

    // ── LEAVE QUEUE ───────────────────────────────────────────
    // Feature 5 edge case: user navigates away → remove from queue (no ghost)
    socket.on("queue-leave", () => removeFromQueue(userId.toString()));

    // Also clean up on disconnect
    socket.on("disconnect", () => removeFromQueue(userId.toString()));
  });
}

// ── Try to pair entry with closest ELO player ─────────────────
function tryMatch(newEntry) {
  const others = queue.filter(u => u.userId !== newEntry.userId);
  if (others.length === 0) return false;

  // Sort by ELO distance
  others.sort((a, b) =>
    Math.abs(a.eloRating - newEntry.eloRating) - Math.abs(b.eloRating - newEntry.eloRating)
  );

  const best = others[0];
  const gap  = Math.abs(best.eloRating - newEntry.eloRating);

  if (gap <= ELO_THRESHOLD) {
    createMatch(newEntry, best);
    return true;
  }
  return false;
}

// ── After 30s: match with anyone regardless of ELO ───────────
function tryMatchAny(entry) {
  const others = queue.filter(u => u.userId !== entry.userId);
  if (others.length === 0) return;
  createMatch(entry, others[0]);
}

// ── Create a game room and tell both players ──────────────────
async function createMatch(playerA, playerB) {
  // Remove both from queue first (prevent double-matching)
  removeFromQueue(playerA.userId);
  removeFromQueue(playerB.userId);

  try {
    const roomId = uuidv4().slice(0, 6).toUpperCase();

    // Randomly assign colors
    const [white, black] = Math.random() > 0.5
      ? [playerA, playerB]
      : [playerB, playerA];

    await Game.create({
      roomId,
      whitePlayer: { userId: white.userId, username: white.username },
      status: "waiting",
      isMatchmade: true,
      eloAtStart: { white: white.eloRating, black: black.eloRating },
    });

    console.log(`⚔️  Match created: ${white.username} vs ${black.username} → room ${roomId}`);

    // Tell each player to navigate to the room
    // Use global io to reach sockets by ID
    const { Server } = require("socket.io");
    // We need io — it's passed via closure from server.js
    // So we use a module-level reference set in registerMatchmaking
    _io.to(white.socketId).emit("match-found", { roomId, color: "white", opponent: black.username, opponentElo: black.eloRating });
    _io.to(black.socketId).emit("match-found", { roomId, color: "black", opponent: white.username, opponentElo: white.eloRating });
  } catch (err) {
    console.error("createMatch error:", err);
  }
}

// ── Remove player from queue + clear their wait timer ─────────
function removeFromQueue(userId) {
  const idx = queue.findIndex(u => u.userId === userId);
  if (idx !== -1) queue.splice(idx, 1);
  if (waitTimers[userId]) {
    clearTimeout(waitTimers[userId]);
    delete waitTimers[userId];
  }
}

// Module-level io ref so createMatch can emit to specific sockets
let _io;
function registerMatchmakingWithIo(io) {
  _io = io;
  registerMatchmaking(io);
}

// ── GET /api/game/queue-size — public endpoint for UI ─────────
function getQueueSize() { return queue.length; }

module.exports = { registerMatchmakingWithIo, getQueueSize };
