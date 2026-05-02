const { Chess } = require("chess.js");
const Game = require("../models/Game");

// In-memory rooms: roomId → { chess, players: {white, black}, spectators, chat }
const activeRooms = {};

function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // ── JOIN ROOM ────────────────────────────────────────────
    socket.on("join-room", async ({ roomId, username, userId, role }) => {
      try {
        const game = await Game.findOne({ roomId });
        if (!game) return socket.emit("error", { message: "Room not found" });

        // Init in-memory room if first connection
        if (!activeRooms[roomId]) {
          activeRooms[roomId] = {
            chess: new Chess(game.currentFen),
            players: { white: null, black: null },
            spectators: [],
            chat: [],
          };
        }

        const room = activeRooms[roomId];
        socket.join(roomId);

        let assignedColor = null;

        if (role === "player") {
          const whiteId = game.whitePlayer?.userId?.toString();
          const blackId = game.blackPlayer?.userId?.toString();

          if (whiteId === userId) {
            // ✅ FIX: Always update socketId on rejoin (was missing before)
            assignedColor = "white";
            room.players.white = { username, userId, socketId: socket.id };

          } else if (!game.blackPlayer?.userId) {  // ✅ FIX: Mongoose returns {} not null
            // First other player claims Black
            assignedColor = "black";
            room.players.black = { username, userId, socketId: socket.id };
            await Game.findOneAndUpdate({ roomId }, {
              blackPlayer: { userId, username },
              status: "active",
            });
            // Tell white + spectators that game is now active
            socket.to(roomId).emit("player-joined", { username, players: room.players, status: "active" });

          } else if (blackId === userId) {
            // ✅ FIX: Black player rejoin also updates socketId
            assignedColor = "black";
            room.players.black = { username, userId, socketId: socket.id };

          } else {
            role = "spectator"; // Room full → become spectator
          }
        }

        if (role === "spectator") {
          room.spectators.push({ username, userId, socketId: socket.id });
          await Game.findOneAndUpdate(
            { roomId, "spectators.userId": { $ne: userId } },
            { $push: { spectators: { userId, username } } }
          );
        }

        // Tell joining socket their assignment
        socket.emit("room-joined", {
          color: assignedColor,
          role,
          fen: room.chess.fen(),
          players: room.players,
          spectatorCount: room.spectators.length,
          chat: room.chat.slice(-50),
          status: game.blackPlayer?.userId ? "active" : game.status,
        });

        console.log(`👤 ${username} → room ${roomId} as ${assignedColor || role}`);
      } catch (err) {
        console.error("join-room error:", err);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    // ── CHESS MOVE ───────────────────────────────────────────
    socket.on("move", async ({ roomId, from, to, promotion = "q" }) => {
      try {
        const room = activeRooms[roomId];
        if (!room) return socket.emit("error", { message: "Room not active" });

        const chess = room.chess;
        const turn = chess.turn();
        const isWhite = room.players.white?.socketId === socket.id;
        const isBlack = room.players.black?.socketId === socket.id;

        // Validate turn ownership
        if ((turn === "w" && !isWhite) || (turn === "b" && !isBlack)) {
          return socket.emit("error", { message: "Not your turn" });
        }

        const move = chess.move({ from, to, promotion });
        if (!move) return socket.emit("error", { message: "Invalid move" });

        const newFen = chess.fen();

        // Persist move
        await Game.findOneAndUpdate({ roomId }, {
          $push: { moves: { from, to, piece: move.piece, fen: newFen } },
          currentFen: newFen,
        });

        io.to(roomId).emit("move-made", {
          from, to, fen: newFen,
          turn: chess.turn(),
          isCheck: chess.isCheck(),
          isCapture: !!move.captured, // ✅ tells frontend to play capture sound
        });

        // Handle game over
        if (chess.isGameOver()) {
          const winner = chess.isCheckmate()
            ? (turn === "w" ? "white" : "black")
            : "draw";
          const endReason = chess.isCheckmate() ? "checkmate" : "draw";

          await Game.findOneAndUpdate({ roomId }, { status: "finished", winner, endReason });
          io.to(roomId).emit("game-over", { winner, endReason });
          delete activeRooms[roomId];
        }
      } catch (err) {
        console.error("move error:", err);
        socket.emit("error", { message: "Move failed" });
      }
    });

    // ── CHAT MESSAGE ─────────────────────────────────────────
    socket.on("chat-message", ({ roomId, username, message }) => {
      if (!message?.trim() || !activeRooms[roomId]) return;

      const entry = {
        username,
        message: message.trim().slice(0, 500),
        time: new Date().toISOString(),
      };

      activeRooms[roomId].chat.push(entry);
      if (activeRooms[roomId].chat.length > 100) activeRooms[roomId].chat.shift();

      io.to(roomId).emit("chat-message", entry);
    });

    // ── TYPING INDICATOR ─────────────────────────────────────
    socket.on("typing", ({ roomId, username }) => {
      socket.to(roomId).emit("typing", { username });
    });

    // ── VOICE: user joins voice channel ─────────────────────
    // Broadcasts to others so they can initiate WebRTC
    socket.on("voice-join", ({ roomId, username }) => {
      socket.to(roomId).emit("voice-user-joined", {
        socketId: socket.id,
        username,
      });
      // Send current room users list back to the joiner
      const room = activeRooms[roomId];
      if (room) {
        const users = [
          room.players.white,
          room.players.black,
          ...room.spectators,
        ].filter(Boolean).map(u => ({ ...u }));
        socket.emit("room-users", users);
      }
    });

    // ── VOICE: user leaves voice channel ────────────────────
    socket.on("voice-leave", ({ roomId }) => {
      socket.to(roomId).emit("voice-user-left", { socketId: socket.id });
    });

    // ── VOICE: WebRTC signal relay ───────────────────────────
    // Passes offer/answer/ICE between peers
    socket.on("voice-signal", ({ roomId, signal, to, fromUsername }) => {
      io.to(to).emit("voice-signal", {
        signal,
        from: socket.id,
        fromUsername,
      });
    });

    // ── SPEAKING indicator relay ─────────────────────────────
    socket.on("speaking", ({ roomId, isSpeaking }) => {
      socket.to(roomId).emit("user-speaking", {
        socketId: socket.id,
        isSpeaking,
      });
    });

    // ── RESIGN ───────────────────────────────────────────────
    socket.on("resign", async ({ roomId, color }) => {
      const winner = color === "white" ? "black" : "white";
      await Game.findOneAndUpdate({ roomId }, {
        status: "finished", winner, endReason: "resignation",
      });
      io.to(roomId).emit("game-over", { winner, endReason: "resignation" });
      if (activeRooms[roomId]) delete activeRooms[roomId];
    });

    // ── DISCONNECT ───────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`🔌 Disconnected: ${socket.id}`);

      for (const [roomId, room] of Object.entries(activeRooms)) {
        const wasWhite = room.players.white?.socketId === socket.id;
        const wasBlack = room.players.black?.socketId === socket.id;
        const specIdx = room.spectators.findIndex(s => s.socketId === socket.id);

        if (wasWhite || wasBlack) {
          // Null out the slot but keep room alive (player may rejoin)
          if (wasWhite) room.players.white = { ...room.players.white, socketId: null };
          if (wasBlack) room.players.black = { ...room.players.black, socketId: null };
          io.to(roomId).emit("player-disconnected", {
            color: wasWhite ? "white" : "black",
          });
          // Also notify voice channel
          io.to(roomId).emit("voice-user-left", { socketId: socket.id });
        } else if (specIdx !== -1) {
          room.spectators.splice(specIdx, 1);
          io.to(roomId).emit("voice-user-left", { socketId: socket.id });
        }
      }
    });
  });
}

module.exports = registerSocketHandlers;