// src/Pages/ChessPage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import "../styles/ChessPage.css";
import { socket, connectSocket } from "../services/socket";
import ChatVoicePanel from "../components/ChatVoicePanel";

// ── Shared AudioContext (Issue 5 fix) ─────────────────────────
// Creating a new AudioContext on every sound call leaks resources
// and gets blocked by browsers after ~6 instances. One shared
// instance is created lazily on first use and reused forever.
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

// ── Chess sounds via Web Audio API (no files needed) ──────────
function playSound(type) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === "move") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } else if (type === "capture") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.28, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(); osc.stop(ctx.currentTime + 0.22);
    } else if (type === "check") {
      osc.type = "square";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } else if (type === "gameover") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    } else if (type === "lowtime") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    }
  } catch (e) { /* AudioContext blocked — ignore silently */ }
}

// ── Format seconds → "MM:SS" ──────────────────────────────────
function fmtTimer(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Piece point values ─────────────────────────────────────────
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_SYMBOLS = {
  wP: "♙", wN: "♘", wB: "♗", wR: "♖", wQ: "♕",
  bP: "♟", bN: "♞", bB: "♝", bR: "♜", bQ: "♛",
};

// ── Calculate captured pieces + material advantage from FEN ───
function getCaptured(fen) {
  const initial = { p:8, n:2, b:2, r:2, q:1 };
  const board   = fen.split(" ")[0];
  const counts  = { w:{}, b:{} };

  for (const ch of board) {
    if (ch === "/" || ch === " ") continue;
    if (/\d/.test(ch)) continue;
    const color = ch === ch.toUpperCase() ? "w" : "b";
    const piece = ch.toLowerCase();
    if (!counts[color][piece]) counts[color][piece] = 0;
    counts[color][piece]++;
  }

  const captured = { white: {}, black: {} };
  for (const piece of ["p","n","b","r","q"]) {
    const wRemaining = counts.w[piece] || 0;
    const bRemaining = counts.b[piece] || 0;
    captured.black[piece] = Math.max(0, initial[piece] - wRemaining);
    captured.white[piece] = Math.max(0, initial[piece] - bRemaining);
  }

  let score = 0;
  for (const piece of ["p","n","b","r","q"]) {
    score += ((counts.w[piece] || 0) - (counts.b[piece] || 0)) * PIECE_VALUES[piece];
  }

  return { captured, score };
}

// ── Module-level chat history store ───────────────────────────
const _chatStore = {};
function getChatHistory(roomId) {
  if (!_chatStore[roomId]) _chatStore[roomId] = [];
  return _chatStore[roomId];
}
function saveChatMsg(roomId, msg) {
  if (!_chatStore[roomId]) _chatStore[roomId] = [];
  const dup = _chatStore[roomId].some(m => m.username === msg.username && m.time === msg.time);
  if (!dup) _chatStore[roomId].push(msg);
}

// ─────────────────────────────────────────────────────────────
// ChessPage Component
// ─────────────────────────────────────────────────────────────
function ChessPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  const user     = JSON.parse(localStorage.getItem("user") || "{}");
  const username = user.username || "Player";
  const userId   = user.id || username;

  // ── Chess state ───────────────────────────────────────────
  const [game, setGame]               = useState(new Chess());
  const [boardTheme, setBoardTheme]   = useState("classic");
  const [squareStyles, setSquareStyles] = useState({});
  const [selectedSq, setSelectedSq]   = useState(null);
  // FIX: moveHistory stores {san, from, to} objects so we can track each move properly
  const [moveHistory, setMoveHistory] = useState([]); // array of SAN strings
  const [allFens, setAllFens]         = useState(["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]);
  const [viewIndex, setViewIndex]     = useState(-1);
  const [error, setError]             = useState(null);

  // ── Room state ────────────────────────────────────────────
  const [myColor, setMyColor]         = useState(null);
  const [status, setStatus]           = useState("connecting");
  const [players, setPlayers]         = useState({ white: null, black: null });
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [gameOverMsg, setGameOverMsg] = useState(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [copied, setCopied]           = useState(false);
  const [codeCopied, setCodeCopied]   = useState(false);

  // ── Timer state ───────────────────────────────────────────
  const [timers, setTimers] = useState({ white: 600, black: 600 });

  // ── Panel ─────────────────────────────────────────────────
  const [showPanel, setShowPanel]     = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Board width (responsive) ──────────────────────────────
  const [boardWidth, setBoardWidth]   = useState(480);

  // ── Refs ──────────────────────────────────────────────────
  const myColorRef  = useRef(null);
  const statusRef   = useRef("connecting");
  const joinedRef   = useRef(false);
  const lowTimePlayed = useRef(false);
  // FIX: store the live game in a ref so socket handlers always see latest FEN
  const gameRef     = useRef(new Chess());

  const shareLink = `${window.location.origin}/chess/${roomId}`;

  const themes = {
    classic:  { dark: "#769656", light: "#eeeed2" },
    midnight: { dark: "#4a4a6a", light: "#9b9bc4" },
    fire:     { dark: "#8b2500", light: "#f5c87a" },
    ice:      { dark: "#2c6e8a", light: "#c8e6f0" },
  };

  // ── Responsive board width ────────────────────────────────
  useEffect(() => {
    function calc() {
      const sw = window.innerWidth < 900 ? 0 : 220;
      const pw = showPanel ? 340 : 0;
      setBoardWidth(Math.max(280, Math.min(520, window.innerWidth - sw - pw - 80)));
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [showPanel]);

  // ── Low time warning sound ────────────────────────────────
  useEffect(() => {
    if (!myColor || status !== "active") return;
    const myTime = timers[myColor];
    if (myTime === 60) { playSound("lowtime"); lowTimePlayed.current = true; }
    if (myTime <= 10 && myTime > 0) playSound("lowtime");
  }, [timers, myColor, status]);

  const copyLink = () => { navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const copyCode = () => { navigator.clipboard.writeText(roomId); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); };

  // ── Unread badge ──────────────────────────────────────────
  useEffect(() => {
    // FIX: store named handler so we can remove exactly this one
    const h = (msg) => {
      saveChatMsg(roomId, msg);
      if (!showPanel && msg.username !== username) setUnreadCount(n => n + 1);
    };
    socket.on("chat-message", h);
    return () => socket.off("chat-message", h); // ✅ remove exact handler
  }, [showPanel, username, roomId]);

  const handleTogglePanel = () => setShowPanel(prev => {
    if (!prev) setUnreadCount(0);
    return !prev;
  });

  // ── Stable joinRoom ───────────────────────────────────────
  const joinRoom = useCallback(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    statusRef.current = "waiting";
    setStatus("waiting");
    socket.emit("join-room", { roomId });
  }, [roomId]);

  // ── Socket wiring ─────────────────────────────────────────
  useEffect(() => {
    connectSocket();
    if (socket.connected) joinRoom();
    else socket.once("connect", joinRoom);

    // ── FIX: define all handlers as named functions so cleanup removes exactly them ──

    const onRoomJoined = (data) => {
      myColorRef.current = data.color;
      setMyColor(data.color);
      statusRef.current = data.status;
      setStatus(data.status);
      setPlayers(data.players || { white: null, black: null });
      setSpectatorCount(data.spectatorCount || 0);
      if (data.timers) setTimers(data.timers);
      setIsDisconnected(false);

      // ── FIX: Rebuild move history by replaying moves (not from Chess FEN)
      // Chess.js built from a FEN has no history — must replay from move list
      if (data.moves && data.moves.length > 0) {
        const g = new Chess(); // start from initial position
        const fens = [g.fen()];
        const history = [];
        for (const m of data.moves) {
          try {
            const result = g.move({ from: m.from, to: m.to, promotion: "q" });
            if (result) {
              fens.push(g.fen());
              history.push(result.san);
            }
          } catch (e) { /* skip invalid */ }
        }
        gameRef.current = g;
        setGame(new Chess(g.fen()));
        setAllFens(fens);
        setMoveHistory(history);
        setViewIndex(-1);
      } else if (data.fen) {
        const g = new Chess(data.fen);
        gameRef.current = g;
        setGame(new Chess(data.fen));
        setAllFens([data.fen]);
        setMoveHistory([]);
      }

      if (data.chat && data.chat.length > 0) {
        data.chat.forEach(msg => saveChatMsg(roomId, msg));
      }
    };

    // FIX: player-joined also needs to update players list for white player
    // (white is already in room when black joins — white only gets player-joined, not room-joined)
    const onPlayerJoined = (data) => {
      statusRef.current = data?.status || "active";
      setStatus(data?.status || "active");
      // ✅ Always update players so white sees black's name immediately
      if (data?.players) setPlayers(data.players);
      if (data?.timers) setTimers(data.timers);
      setIsDisconnected(false);
    };

    // FIX: move-made — backend is source of truth
    // Do NOT optimistically update board. Only update from this event.
    // FIX: move history must be maintained incrementally, not rebuilt from Chess(fen).history()
    // because Chess(fen) has no history — it's a snapshot.
    const onMoveMade = (data) => {
      // Append the new FEN and SAN to our tracked lists
      setAllFens(prev => {
        if (prev[prev.length - 1] === data.fen) return prev;
        return [...prev, data.fen];
      });
      // FIX: append just the new SAN move — don't rebuild history from FEN
      if (data.san) {
        setMoveHistory(prev => [...prev, data.san]);
      }
      // Update game ref and state to the server-confirmed FEN
      const g = new Chess(data.fen);
      gameRef.current = g;
      setGame(g);
      setViewIndex(-1);
      setSquareStyles({
        [data.from]: { backgroundColor: "rgba(255,200,0,0.45)" },
        [data.to]:   { backgroundColor: "rgba(255,200,0,0.45)" },
      });
      setSelectedSq(null);
      setError(null);
      if (data.timers) setTimers(data.timers);

      if (data.isCheck)        playSound("check");
      else if (data.isCapture) playSound("capture");
      else                      playSound("move");
    };

    const onTimerTick = ({ timers }) => {
      setTimers(timers);
    };

    const onGameOver = ({ winner, endReason }) => {
      statusRef.current = "finished";
      setStatus("finished");
      playSound("gameover");
      const color = myColorRef.current;
      setGameOverMsg(
        !color
          ? `${winner === "draw" ? "Draw 🤝" : winner + " wins 🏆"} — ${endReason}`
          : winner === "draw" ? "Draw 🤝"
          : winner === color  ? "You won 🏆"
          : "You lost 😔"
      );
    };

    const onPlayerDisconnected = ({ color }) => {
      setIsDisconnected(true);
      setError(`⚠️ ${color} disconnected — waiting for rejoin…`);
    };

    const onError = ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 3000);
    };

    // FIX: on reconnect reset joinedRef and rejoin
    const onReconnect = () => {
      joinedRef.current = false;
      joinRoom();
    };

    // Register all handlers
    socket.on("room-joined",         onRoomJoined);
    socket.on("player-joined",       onPlayerJoined);
    socket.on("move-made",           onMoveMade);
    socket.on("timer-tick",          onTimerTick);
    socket.on("game-over",           onGameOver);
    socket.on("player-disconnected", onPlayerDisconnected);
    socket.on("error",               onError);
    socket.on("connect",             onReconnect);

    return () => {
      // FIX: pass exact handler references to off() — not just event name
      // Removing by name alone removes ALL listeners including other effects
      socket.off("room-joined",         onRoomJoined);
      socket.off("player-joined",       onPlayerJoined);
      socket.off("move-made",           onMoveMade);
      socket.off("timer-tick",          onTimerTick);
      socket.off("game-over",           onGameOver);
      socket.off("player-disconnected", onPlayerDisconnected);
      socket.off("error",               onError);
      socket.off("connect",             onReconnect);
    };
  }, [joinRoom, roomId]);

  // ── Legal move highlighting ───────────────────────────────
  function getLegalStyles(sq) {
    const moves  = game.moves({ square: sq, verbose: true });
    const styles = { [sq]: { background: "rgba(255,200,0,0.5)", borderRadius: "4px" } };
    moves.forEach(m => {
      const isCapture = !!game.get(m.to);
      styles[m.to] = isCapture
        ? { background: "radial-gradient(circle, transparent 58%, rgba(0,0,0,0.35) 58%, rgba(0,0,0,0.35) 68%, transparent 68%)" }
        : { background: "radial-gradient(circle, rgba(0,0,0,0.25) 26%, transparent 26%)" };
    });
    return styles;
  }

  function onDragBegin(piece, sq) {
    setSquareStyles(getLegalStyles(sq));
    setSelectedSq(sq);
  }

  function onSquareClick(sq) {
    if (viewIndex !== -1) return;
    if (statusRef.current !== "active" || !myColorRef.current) return;
    const mine = myColorRef.current === "white" ? "w" : "b";

    if (!selectedSq) {
      const piece = game.get(sq);
      if (!piece || piece.color !== mine || piece.color !== game.turn()) return;
      setSelectedSq(sq);
      setSquareStyles(getLegalStyles(sq));
      return;
    }

    if (selectedSq === sq) {
      setSelectedSq(null); setSquareStyles({}); return;
    }

    const legalMoves = game.moves({ square: selectedSq, verbose: true });
    const isLegal    = legalMoves.some(m => m.to === sq);

    if (isLegal) {
      onDrop(selectedSq, sq);
      setSelectedSq(null);
    } else {
      const piece = game.get(sq);
      if (piece && piece.color === mine && piece.color === game.turn()) {
        setSelectedSq(sq);
        setSquareStyles(getLegalStyles(sq));
      } else {
        setSelectedSq(null); setSquareStyles({});
      }
    }
  }

  // FIX: onDrop — do NOT update local game state or move history here.
  // Only emit the move to server. The board updates ONLY when move-made comes back.
  // This prevents board desync and double-updates.
  function onDrop(from, to) {
    if (statusRef.current !== "active") {
      setError("⏳ Waiting for opponent…");
      setTimeout(() => setError(null), 2000);
      return false;
    }
    if (viewIndex !== -1) {
      setError("⚠️ Exit review mode to make moves");
      setTimeout(() => setError(null), 2000);
      return false;
    }

    // Validate move locally first (for instant visual feedback)
    // but use a COPY of the game — don't modify state yet
    const testGame = new Chess(gameRef.current.fen());
    let move = null;
    try {
      move = testGame.move({ from, to, promotion: "q" });
    } catch { /* invalid */ }

    if (!move) {
      setError("❌ Invalid move");
      setTimeout(() => setError(null), 2000);
      return false;
    }

    // 🔥 INSTANT UI UPDATE



  gameRef.current = testGame;
  setGame(new Chess(testGame.fen()));

    // ✅ Optimistically show highlight squares — board FEN stays unchanged
    // Real board update happens in onMoveMade when server echoes back
    setSquareStyles({
      [from]: { backgroundColor: "rgba(255,200,0,0.45)" },
      [to]:   { backgroundColor: "rgba(255,200,0,0.45)" },
    });

    // Emit to server — server validates and broadcasts move-made to everyone including us
    socket.emit("move", { roomId, from, to, promotion: "q" });
    return true;
  }

  function isPieceDraggable({ piece }) {
    if (statusRef.current !== "active" || !myColorRef.current) return false;
    if (viewIndex !== -1) return false;
    const mine = myColorRef.current === "white" ? "w" : "b";
    return piece[0] === mine && piece[0] === game.turn();
  }

  function handleResign() {
    if (window.confirm("Resign this game?"))
      socket.emit("resign", { roomId });
  }

  function handleRejoin() {
    joinedRef.current = false;
    joinRoom();
    setIsDisconnected(false);
    setError(null);
  }

  function goToMove(idx) {
    setViewIndex(idx);
    setSquareStyles({});
    setSelectedSq(null);
  }

  const displayFen = viewIndex === -1
    ? game.fen()
    : allFens[viewIndex + 1] || game.fen();

  const { captured, score } = getCaptured(game.fen());

  function renderCaptured(color) {
    const caps = captured[color];
    const symbols = [];
    for (const [piece, count] of Object.entries(caps)) {
      const sym = color === "white"
        ? PIECE_SYMBOLS["b" + piece.toUpperCase()]
        : PIECE_SYMBOLS["w" + piece.toUpperCase()];
      for (let i = 0; i < count; i++) symbols.push(sym);
    }
    return symbols;
  }

  function getStatus() {
    if (status === "connecting") return { text: "Connecting…",           cls: "s-wait"   };
    if (status === "waiting")    return { text: "Waiting for opponent…", cls: "s-wait"   };
    if (status === "finished")   return { text: gameOverMsg,             cls: "s-over"   };
    if (!myColor)                return { text: "👁 Spectating",          cls: "s-spec"   };
    const myTurn = game.turn() === (myColor === "white" ? "w" : "b");
    return { text: myTurn ? "Your turn ✅" : "Opponent's turn…", cls: myTurn ? "s-yours" : "s-theirs" };
  }

  const st          = getStatus();
  const isSpectator = !myColor && status !== "connecting" && status !== "waiting";
  const isReviewing = viewIndex !== -1;

  const movePairs = [];
  for (let i = 0; i < moveHistory.length; i += 2)
    movePairs.push({ n: i / 2 + 1, w: moveHistory[i], wIdx: i, b: moveHistory[i + 1] || "", bIdx: i + 1 });

  const timerCls = (color) => {
    const t = timers[color];
    if (t <= 30) return "cp-timer danger";
    if (t <= 60) return "cp-timer warning";
    return "cp-timer";
  };

  return (
    <div className="cp-page">

      {/* ═══════ SIDEBAR ═══════ */}
      <aside className="cp-sidebar">

        {/* Players + captured pieces + timers */}
        <div className="cp-card">
          <p className="cp-card-label">PLAYERS</p>

          {[
            { color: "black", letter: "b", symbol: "♟", capturedBy: "white" },
            { color: "white", letter: "w", symbol: "♙", capturedBy: "black" },
          ].map(({ color, letter, symbol, capturedBy }) => (
            <div key={color} className={`cp-player-row${game.turn() === letter && status === "active" && !isReviewing ? " cp-my-turn" : ""}`}>
              <div className={`cp-avatar cp-av-${color}`}>
                {(players[color]?.username || "?")[0].toUpperCase()}
              </div>
              <div className="cp-pinfo">
                <span className="cp-pname">
                  {players[color]?.username || "Waiting…"}
                  {myColor === color && <span className="cp-you">YOU</span>}
                </span>
                <span className="cp-pcolor">{symbol} {color}</span>
                <span className="cp-captured">
                  {renderCaptured(capturedBy).join(" ")}
                  {(() => {
                    const adv = capturedBy === "white" ? score : -score;
                    return adv > 0 ? <span className="cp-adv">+{adv}</span> : null;
                  })()}
                </span>
              </div>
              <div className={timerCls(color)}>
                {fmtTimer(timers[color])}
              </div>
              {game.turn() === letter && status === "active" && !isReviewing && (
                <span className="cp-dot" />
              )}
            </div>
          ))}

          {spectatorCount > 0 && (
            <p className="cp-spec-count">👁 {spectatorCount} watching</p>
          )}
        </div>

        {/* Move history */}
        <div className="cp-card cp-moves-card">
          <div className="cp-moves-header">
            <p className="cp-card-label" style={{margin:0}}>MOVES</p>
            {isReviewing && (
              <button className="cp-live-btn" onClick={() => goToMove(-1)}>
                ▶ Live
              </button>
            )}
          </div>
          <div className="cp-moves">
            {movePairs.length === 0 && <span className="cp-no-moves">No moves yet</span>}
            {movePairs.map(p => (
              <div key={p.n} className="cp-mrow">
                <span className="cp-mn">{p.n}.</span>
                <span
                  className={`cp-mw cp-move-btn${viewIndex === p.wIdx ? " cp-move-active" : ""}`}
                  onClick={() => goToMove(p.wIdx)}
                  title={`Go to move ${p.n} (white)`}
                >{p.w}</span>
                {p.b && (
                  <span
                    className={`cp-mb cp-move-btn${viewIndex === p.bIdx ? " cp-move-active" : ""}`}
                    onClick={() => goToMove(p.bIdx)}
                    title={`Go to move ${p.n} (black)`}
                  >{p.b}</span>
                )}
              </div>
            ))}
          </div>
          {moveHistory.length > 0 && (
            <div className="cp-move-nav">
              <button onClick={() => goToMove(0)} title="First move">⏮</button>
              <button onClick={() => goToMove(Math.max(0, (viewIndex === -1 ? moveHistory.length - 1 : viewIndex) - 1))} title="Previous">◀</button>
              <button onClick={() => {
                const cur = viewIndex === -1 ? moveHistory.length - 1 : viewIndex;
                const next = cur + 1;
                if (next >= moveHistory.length) goToMove(-1);
                else goToMove(next);
              }} title="Next">▶</button>
              <button onClick={() => goToMove(-1)} title="Latest">⏭</button>
            </div>
          )}
        </div>

        {/* Board themes */}
        <div className="cp-card">
          <p className="cp-card-label">THEME</p>
          <div className="cp-theme-grid">
            {Object.entries(themes).map(([name, t]) => (
              <button
                key={name}
                className={`cp-theme-btn${boardTheme === name ? " cp-theme-on" : ""}`}
                onClick={() => setBoardTheme(name)}
                style={{ background: `linear-gradient(135deg, ${t.light} 50%, ${t.dark} 50%)` }}
                title={name}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* ═══════ MAIN ═══════ */}
      <main className="cp-main">

        {/* Top bar */}
        <div className="cp-topbar">
          <button className="cp-btn cp-home" onClick={() => navigate("/")}>← Home</button>
          <div className="cp-code-box">
            <span className="cp-code-label">ROOM</span>
            <span className="cp-code-val">{roomId}</span>
            <button className="cp-icon-btn" onClick={copyCode}>{codeCopied ? "✅" : "📋"}</button>
            <button className="cp-icon-btn" onClick={copyLink}>{copied ? "✅" : "🔗"}</button>
          </div>
          <button
            className={`cp-btn cp-chat-btn${showPanel ? " cp-chat-on" : ""}`}
            onClick={handleTogglePanel}
          >
            💬 Chat
            {!showPanel && unreadCount > 0 && (
              <span className="cp-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
            )}
          </button>
        </div>

        {/* Status + review banner */}
        {isReviewing ? (
          <div className="cp-status s-spec">
            📖 Reviewing move {viewIndex + 1} — <span className="cp-link" onClick={() => goToMove(-1)}>back to live</span>
          </div>
        ) : (
          <div className={`cp-status ${st.cls}`}>{st.text}</div>
        )}

        {isSpectator && <div className="cp-spec-banner">👁 Spectating — view only</div>}

        {isDisconnected && status !== "finished" && (
          <div className="cp-rejoin-banner">
            ⚠️ Opponent disconnected
            <button className="cp-rejoin-btn" onClick={handleRejoin}>🔄 Reconnect</button>
          </div>
        )}

        {error && !isDisconnected && <div className="cp-error-toast">{error}</div>}

        {/* Board */}
        <div className="cp-board">
          <Chessboard
            position={displayFen}
            onPieceDrop={onDrop}
            onPieceDragBegin={onDragBegin}
            onPieceDragEnd={() => { setSquareStyles({}); setSelectedSq(null); }}
            onSquareClick={onSquareClick}
            customSquareStyles={squareStyles}
            isDraggablePiece={isPieceDraggable}
            boardWidth={boardWidth}
            boardOrientation={myColor || "white"}
            customDarkSquareStyle={{ backgroundColor: themes[boardTheme].dark }}
            customLightSquareStyle={{ backgroundColor: themes[boardTheme].light }}
            areArrowsAllowed={false}
          />
        </div>

        {/* Bottom actions */}
        <div className="cp-bottom">
          {status === "active" && myColor && !isReviewing && (
            <button className="cp-btn cp-resign" onClick={handleResign}>🏳️ Resign</button>
          )}
          {status === "finished" && (
            <button className="cp-btn cp-home" onClick={() => navigate("/")}>🏠 Back to Lobby</button>
          )}
        </div>
      </main>

      {/* ═══════ PANEL ═══════ */}
      {showPanel && (
        <ChatVoicePanel roomId={roomId} username={username} isOpen={showPanel} />
      )}
    </div>
  );
}

export default ChessPage;