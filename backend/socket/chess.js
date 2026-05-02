// socket/chess.js
const { Chess } = require("chess.js");
const Game      = require("../models/Game");

// In-memory rooms (rebuilt from DB on server restart)
// roomId → { chess, players:{white,black}, spectators[], chat[], timers, timerInterval }
const activeRooms = {};

const TIMER_SECONDS = 10 * 60; // 10 min per player

// ── Timer helpers ─────────────────────────────────────────────
function startTimer(io, roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  stopTimer(roomId); // clear any existing interval first

  room.timerInterval = setInterval(async () => {
    const color = room.chess.turn() === "w" ? "white" : "black";
    room.timers[color] -= 1;
    io.to(roomId).emit("timer-tick", { timers: room.timers });

    if (room.timers[color] <= 0) {
      stopTimer(roomId);
      const winner    = color === "white" ? "black" : "white";
      const endReason = "timeout";
      await Game.findOneAndUpdate({ roomId }, { status: "finished", winner, endReason });
      io.to(roomId).emit("game-over", { winner, endReason });
      delete activeRooms[roomId];
    }
  }, 1000);
}

function stopTimer(roomId) {
  const room = activeRooms[roomId];
  if (room?.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
}

// ── Main handler ──────────────────────────────────────────────
function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    // socket.user = { id, username } — set by JWT middleware in server.js
    const { id: userId, username } = socket.user;
    console.log(`🔌 Connected: ${socket.id} (${username})`);

    // ── JOIN ROOM ─────────────────────────────────────────────
    // fix #5: backend ignores duplicate join — just updates socketId
    // fix #1/#6: identity from socket.user, not client payload
    socket.on("join-room", async ({ roomId }) => {
      try {
        const game = await Game.findOne({ roomId });
        if (!game) return socket.emit("error", { message: "Room not found" });

        // Rebuild room from DB if server restarted (fix #10)
        if (!activeRooms[roomId]) {
          activeRooms[roomId] = {
            chess:         new Chess(game.currentFen),
            players:       { white: null, black: null },
            spectators:    [],
            chat:          [],
            timers:        { white: TIMER_SECONDS, black: TIMER_SECONDS },
            timerInterval: null,
          };
          // Restore existing players from DB
          if (game.whitePlayer?.userId) {
            activeRooms[roomId].players.white = {
              username: game.whitePlayer.username,
              userId:   game.whitePlayer.userId,
              socketId: null,
            };
          }
          if (game.blackPlayer?.userId) {
            activeRooms[roomId].players.black = {
              username: game.blackPlayer.username,
              userId:   game.blackPlayer.userId,
              socketId: null,
            };
          }
        }

        const room = activeRooms[roomId];
        socket.join(roomId);

        let assignedColor = null;
        let role          = "player";

        const whiteId = game.whitePlayer?.userId?.toString();
        const blackId = game.blackPlayer?.userId?.toString();
        const myId    = userId.toString();

        if (whiteId === myId) {
          // Returning white player — just update socketId
          assignedColor = "white";
          room.players.white = { username, userId: myId, socketId: socket.id };

        } else if (!game.blackPlayer?.userId) {
          // First new player claims black
          assignedColor = "black";
          room.players.black = { username, userId: myId, socketId: socket.id };
          await Game.findOneAndUpdate({ roomId }, {
            blackPlayer: { userId: myId, username },
            status: "active",
          });
          startTimer(io, roomId);
          socket.to(roomId).emit("player-joined", {
            username, players: room.players, status: "active", timers: room.timers,
          });

        } else if (blackId === myId) {
          // Returning black player
          assignedColor = "black";
          room.players.black = { username, userId: myId, socketId: socket.id };
          // Resume timer if game still active
          if (game.status === "active" && !room.timerInterval) startTimer(io, roomId);

        } else {
          // fix #8: multiple tabs / third user → spectator
          role = "spectator";
        }

        if (role === "spectator") {
          // Avoid duplicate spectator entries
          const alreadySpec = room.spectators.find(s => s.userId === myId);
          if (alreadySpec) alreadySpec.socketId = socket.id;
          else room.spectators.push({ username, userId: myId, socketId: socket.id });

          await Game.findOneAndUpdate(
            { roomId, "spectators.userId": { $ne: myId } },
            { $push: { spectators: { userId: myId, username } } }
          );
        }

        // Send full state to joiner
        socket.emit("room-joined", {
          color:          assignedColor,
          role,
          fen:            room.chess.fen(),
          players:        room.players,
          spectatorCount: room.spectators.length,
          chat:           room.chat.slice(-100),  // last 100 messages (fix #3)
          status:         game.blackPlayer?.userId ? "active" : game.status,
          timers:         room.timers,
          // Full move list so client can reconstruct history (fix rejoin)
          moves:          game.moves.map(m => ({ from: m.from, to: m.to, san: m.san, fen: m.fen })),
        });

        console.log(`👤 ${username} → ${roomId} as ${assignedColor || role}`);
      } catch (err) {
        console.error("join-room error:", err);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    // ── MOVE ──────────────────────────────────────────────────
    // fix #2: server is source of truth — board only updates on move-made emit
    // fix #9: turn ownership strictly validated
    // fix #11: spectators blocked
    socket.on("move", async ({ roomId, from, to, promotion = "q" }) => {
      try {
        const room = activeRooms[roomId];
        if (!room) return socket.emit("error", { message: "Room not active" });

        const chess   = room.chess;
        const turn    = chess.turn();
        const isWhite = room.players.white?.socketId === socket.id;
        const isBlack = room.players.black?.socketId === socket.id;

        // fix #11: block spectators and wrong-turn moves
        if (!isWhite && !isBlack)
          return socket.emit("error", { message: "Spectators cannot move" });
        if ((turn === "w" && !isWhite) || (turn === "b" && !isBlack))
          return socket.emit("error", { message: "Not your turn" });

        // Validate move
        const move = chess.move({ from, to, promotion });
        if (!move) return socket.emit("error", { message: "Invalid move" });

        const newFen = chess.fen();

        await Game.findOneAndUpdate({ roomId }, {
          $push: { moves: { from, to, piece: move.piece, san: move.san, fen: newFen } },
          currentFen: newFen,
        });

        // Broadcast to everyone — fix #2: frontend only updates on this event
        io.to(roomId).emit("move-made", {
          from, to, fen: newFen, san: move.san,
          turn:      chess.turn(),
          isCheck:   chess.isCheck(),
          isCapture: !!move.captured,
          captured:  move.captured || null,
          timers:    room.timers,
        });

        if (chess.isGameOver()) {
          stopTimer(roomId);
          const winner    = chess.isCheckmate() ? (turn === "w" ? "white" : "black") : "draw";
          const endReason = chess.isCheckmate() ? "checkmate" : "draw";
          await Game.findOneAndUpdate({ roomId }, { status: "finished", winner, endReason });
          // Update win/loss stats
          await updateStats(game, winner);
          io.to(roomId).emit("game-over", { winner, endReason });
          delete activeRooms[roomId];
        }
      } catch (err) {
        console.error("move error:", err);
        socket.emit("error", { message: "Move failed" });
      }
    });

    // ── CHAT ──────────────────────────────────────────────────
    // fix #6: username comes from socket.user, not client payload
    socket.on("chat-message", ({ roomId, message }) => {
      if (!message?.trim() || !activeRooms[roomId]) return;
      const entry = {
        username, // server-owned — client can't spoof this
        message:  message.trim().slice(0, 500),
        time:     new Date().toISOString(),
      };
      activeRooms[roomId].chat.push(entry);
      if (activeRooms[roomId].chat.length > 100) activeRooms[roomId].chat.shift();
      io.to(roomId).emit("chat-message", entry);
    });

    // ── TYPING ────────────────────────────────────────────────
    socket.on("typing", ({ roomId }) => {
      // username from socket.user — not client
      socket.to(roomId).emit("typing", { username });
    });

    // ── VOICE ─────────────────────────────────────────────────
    socket.on("voice-join", ({ roomId }) => {
      socket.to(roomId).emit("voice-user-joined", { socketId: socket.id, username });
      const room = activeRooms[roomId];
      if (room) {
        const users = [room.players.white, room.players.black, ...room.spectators]
          .filter(Boolean).map(u => ({ ...u }));
        socket.emit("room-users", users);
      }
    });

    socket.on("voice-leave", ({ roomId }) => {
      socket.to(roomId).emit("voice-user-left", { socketId: socket.id });
    });

    socket.on("voice-signal", ({ roomId, signal, to }) => {
      io.to(to).emit("voice-signal", { signal, from: socket.id, fromUsername: username });
    });

    socket.on("speaking", ({ roomId, isSpeaking }) => {
      socket.to(roomId).emit("user-speaking", { socketId: socket.id, isSpeaking });
    });

    // ── RESIGN ────────────────────────────────────────────────
    socket.on("resign", async ({ roomId }) => {
      const room = activeRooms[roomId];
      if (!room) return;
      const isWhite = room.players.white?.socketId === socket.id;
      const isBlack = room.players.black?.socketId === socket.id;
      if (!isWhite && !isBlack) return; // spectators can't resign

      stopTimer(roomId);
      const color  = isWhite ? "white" : "black";
      const winner = color === "white" ? "black" : "white";
      await Game.findOneAndUpdate({ roomId }, {
        status: "finished", winner, endReason: "resignation",
      });
      io.to(roomId).emit("game-over", { winner, endReason: "resignation" });
      delete activeRooms[roomId];
    });

    // ── DISCONNECT ────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`🔌 Disconnected: ${socket.id} (${username})`);
      for (const [roomId, room] of Object.entries(activeRooms)) {
        const wasWhite = room.players.white?.socketId === socket.id;
        const wasBlack = room.players.black?.socketId === socket.id;
        const specIdx  = room.spectators.findIndex(s => s.socketId === socket.id);

        if (wasWhite || wasBlack) {
          // Null socketId but keep room alive — player may rejoin
          if (wasWhite) room.players.white.socketId = null;
          if (wasBlack) room.players.black.socketId = null;
          stopTimer(roomId); // pause clock on disconnect
          io.to(roomId).emit("player-disconnected", { color: wasWhite ? "white" : "black" });
          io.to(roomId).emit("voice-user-left", { socketId: socket.id });
        } else if (specIdx !== -1) {
          room.spectators.splice(specIdx, 1);
          io.to(roomId).emit("voice-user-left", { socketId: socket.id });
        }
      }
    });
  });
}

// ── Update win/loss stats after game ends ─────────────────────
async function updateStats(game, winner) {
  try {
    if (winner === "draw") {
      await Promise.all([
        game.whitePlayer?.userId && require("../models/User").findByIdAndUpdate(
          game.whitePlayer.userId, { $inc: { gamesPlayed: 1 } }
        ),
        game.blackPlayer?.userId && require("../models/User").findByIdAndUpdate(
          game.blackPlayer.userId, { $inc: { gamesPlayed: 1 } }
        ),
      ].filter(Boolean));
    } else {
      const winnerId = winner === "white" ? game.whitePlayer?.userId : game.blackPlayer?.userId;
      const loserId  = winner === "white" ? game.blackPlayer?.userId : game.whitePlayer?.userId;
      const User     = require("../models/User");
      await Promise.all([
        winnerId && User.findByIdAndUpdate(winnerId, { $inc: { gamesPlayed: 1, wins: 1 } }),
        loserId  && User.findByIdAndUpdate(loserId,  { $inc: { gamesPlayed: 1, losses: 1 } }),
      ].filter(Boolean));
    }
  } catch (e) { console.error("updateStats error:", e); }
}

module.exports = registerSocketHandlers;