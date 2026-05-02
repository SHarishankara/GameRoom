// src/Pages/ChessPage.jsx
// ─────────────────────────────────────────────────────────────
// The main chess game screen. Handles:
//  - Joining a room via Socket.IO
//  - Rendering the board with react-chessboard
//  - Sending and receiving moves in real time
//  - Showing game status, move history, and player info
//  - Opening the Chat/Voice panel
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import "../styles/ChessPage.css";
import { socket, connectSocket } from "../services/socket";
import ChatVoicePanel from "../components/ChatVoicePanel";

// ── Chess sounds using Web Audio API (no external files needed) ──
// Generates move/capture/check sounds programmatically.
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "move") {
      // Short clean click — like a piece placed on board
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "capture") {
      // Heavier thud — piece taken
      osc.type = "triangle";
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.28, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } else if (type === "check") {
      // Two-tone alert — king is in check
      osc.type = "square";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "gameover") {
      // Descending tone — game ended
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch (e) { /* AudioContext blocked — silently ignore */ }
}


function ChessPage() {
  const navigate = useNavigate();
  const { roomId } = useParams(); // Room code from the URL, e.g. /chess/A3F9B2

  // Pull user identity from localStorage (saved at login)
  const user     = JSON.parse(localStorage.getItem("user") || "{}");
  const username = user.username || "Player";
  const userId   = user.id || username;

  // ── Chess state ───────────────────────────────────────────
  const [game, setGame]                 = useState(new Chess());       // chess.js instance
  const [boardTheme, setBoardTheme]     = useState("classic");         // colour theme name
  const [squareStyles, setSquareStyles] = useState({});                // highlight squares
  const [selectedSq, setSelectedSq]     = useState(null);              // click-to-move selected square
  const [moveHistory, setMoveHistory]   = useState([]);                // list of SAN moves
  const [error, setError]               = useState(null);              // inline error toast

  // ── Room/player state ─────────────────────────────────────
  const [myColor, setMyColor]               = useState(null);          // "white" | "black" | null (spectator)
  const [status, setStatus]                 = useState("connecting");  // connecting/waiting/active/finished
  const [players, setPlayers]               = useState({ white: null, black: null });
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [gameOverMsg, setGameOverMsg]       = useState(null);          // end-of-game message
  const [copied, setCopied]                 = useState(false);         // share-link copy feedback
  const [codeCopied, setCodeCopied]         = useState(false);         // room-code copy feedback

  // ── Chat panel state ──────────────────────────────────────
  const [showPanel, setShowPanel]     = useState(false);
  const [unreadCount, setUnreadCount] = useState(0); // badge on the Chat button

  // ── Board width — responsive ──────────────────────────────
  // FIX: Previously used window.innerWidth - 420 which could go negative on small screens.
  // Now we calculate based on available space after sidebar + panel.
  const [boardWidth, setBoardWidth] = useState(480);

  // myColorRef mirrors myColor as a ref so socket callbacks (which close over stale state)
  // can always read the current value without needing to be re-registered.
  const myColorRef = useRef(null);

  // joinedRef prevents emitting "join-room" twice if the component re-renders
  // or if connectSocket() triggers multiple "connect" events.
  const joinedRef = useRef(false);

  const shareLink = `${window.location.origin}/chess/${roomId}`;

  // Board colour themes — passed to react-chessboard
  const themes = {
    classic:  { dark: "#769656", light: "#eeeed2" },
    midnight: { dark: "#4a4a6a", light: "#9b9bc4" },
    fire:     { dark: "#8b2500", light: "#f5c87a" },
    ice:      { dark: "#2c6e8a", light: "#c8e6f0" },
  };

  // ── Responsive board width ────────────────────────────────
  // Recalculates whenever the panel opens/closes or window resizes.
  // Ensures board is always between 280px (minimum) and 520px (maximum).
  useEffect(() => {
    function updateBoardWidth() {
      const sidebarW = window.innerWidth < 900 ? 0 : 220; // sidebar hidden on mobile
      const panelW   = showPanel ? 340 : 0;               // chat panel width
      const padding  = 80;                                 // breathing room
      const available = window.innerWidth - sidebarW - panelW - padding;
      setBoardWidth(Math.max(280, Math.min(520, available)));
    }
    updateBoardWidth();
    window.addEventListener("resize", updateBoardWidth);
    return () => window.removeEventListener("resize", updateBoardWidth);
  }, [showPanel]);

  // ── Clipboard helpers ─────────────────────────────────────
  const copyLink = () => { navigator.clipboard.writeText(shareLink); setCopied(true);    setTimeout(() => setCopied(false), 2000); };
  const copyCode = () => { navigator.clipboard.writeText(roomId);    setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); };

  // ── Unread message counter ────────────────────────────────
  // Increments the badge on the Chat button when the panel is closed
  // and a message arrives from someone else.
  useEffect(() => {
    const h = (msg) => {
      if (!showPanel && msg.username !== username) setUnreadCount(n => n + 1);
    };
    socket.on("chat-message", h);
    return () => socket.off("chat-message", h);
  }, [showPanel, username]);

  // Reset unread count when the panel is opened
  const handleTogglePanel = () => setShowPanel(prev => {
    if (!prev) setUnreadCount(0);
    return !prev;
  });

  // ── joinRoom ──────────────────────────────────────────────
  // Emits the "join-room" event to the server exactly once.
  // useCallback so the same function reference is used in
  // both the connect handler and the reconnect handler.
  const joinRoom = useCallback(() => {
    if (joinedRef.current) return; // Guard: don't join twice
    joinedRef.current = true;
    setStatus("waiting");
    socket.emit("join-room", { roomId, username, userId, role: "player" });
  }, [roomId, username, userId]);

  // ── Socket event wiring ───────────────────────────────────
  // Registers all socket listeners once on mount.
  // Cleans them up on unmount to avoid memory leaks / double-handling.
  useEffect(() => {
    connectSocket(); // Connect if not already connected

    // If already connected when this effect runs, join immediately.
    // Otherwise wait for the "connect" event (socket.once = fires only once).
    if (socket.connected) joinRoom();
    else socket.once("connect", joinRoom);

    // ── room-joined ────────────────────────────────────────
    // Server confirms we joined and tells us our colour + current board state.
    socket.on("room-joined", (data) => {
      myColorRef.current = data.color;
      setMyColor(data.color);
      setStatus(data.status);
      setPlayers(data.players || { white: null, black: null });
      setSpectatorCount(data.spectatorCount || 0);
      // Restore board to where it currently is (important for rejoin mid-game)
      if (data.fen) {
        const g = new Chess(data.fen);
        setGame(g);
        setMoveHistory(g.history());
      }
    });

    // ── player-joined ──────────────────────────────────────
    // Fired when the second player joins — game becomes "active".
    socket.on("player-joined", (data) => {
      setStatus(data?.status || "active");
      if (data?.players) setPlayers(data.players);
    });

    // ── move-made ──────────────────────────────────────────
    // Fired for BOTH players when any move is made.
    // We rebuild the chess.js instance from the FEN so both
    // boards are always in sync with the server's source of truth.
    socket.on("move-made", (data) => {
      const g = new Chess(data.fen);
      setGame(g);
      setMoveHistory(g.history());
      // Highlight the from/to squares of the last move
      setSquareStyles({
        [data.from]: { backgroundColor: "rgba(255,200,0,0.45)" },
        [data.to]:   { backgroundColor: "rgba(255,200,0,0.45)" },
      });
      setError(null);
      // Play sound — check takes priority over capture over normal move
      if (data.isCheck) playSound("check");
      else if (data.isCapture) playSound("capture");
      else playSound("move");
    });

    // ── game-over ──────────────────────────────────────────
    // Show a personalised end message depending on whether the
    // local player won, lost, drew, or was a spectator.
    socket.on("game-over", ({ winner, endReason }) => {
      setStatus("finished");
      const color = myColorRef.current; // use ref — state may be stale in callback
      playSound("gameover");
      setGameOverMsg(
        !color
          ? `${winner === "draw" ? "Draw 🤝" : winner + " wins 🏆"} — ${endReason}`
          : winner === "draw" ? "Draw 🤝"
          : winner === color  ? "You won 🏆"
          : "You lost 😔"
      );
    });

    // ── player-disconnected ────────────────────────────────
    // Show a warning if the opponent disconnects mid-game.
    // The room stays alive so they can rejoin.
    socket.on("player-disconnected", ({ color }) => {
      setError(`⚠️ ${color} disconnected — waiting for rejoin…`);
    });

    // ── error ──────────────────────────────────────────────
    // Server-side errors (wrong turn, invalid move, etc.)
    // Auto-clear after 3 seconds.
    socket.on("error", ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 3000);
    });

    // ── reconnect guard ────────────────────────────────────
    // If the socket drops and reconnects, reset the join guard
    // and re-emit "join-room" so the server re-registers us.
    const onReconnect = () => { joinedRef.current = false; joinRoom(); };
    socket.on("connect", onReconnect);

    // Cleanup: remove all listeners when component unmounts
    return () => {
      socket.off("connect",             onReconnect);
      socket.off("room-joined");
      socket.off("player-joined");
      socket.off("move-made");
      socket.off("game-over");
      socket.off("player-disconnected");
      socket.off("error");
    };
  }, [joinRoom]);

  // ── getLegalStyles — chess.com style dots ─────────────────
  // Empty squares get a small filled dot; capture squares get
  // a hollow ring around the existing piece (like chess.com).
  function getLegalStyles(sq, currentGame) {
    const g = currentGame || game;
    const moves  = g.moves({ square: sq, verbose: true });
    const styles = {
      [sq]: { background: "rgba(255,200,0,0.5)", borderRadius: "4px" }, // source highlight
    };
    moves.forEach(m => {
      const isCapture = !!g.get(m.to);
      styles[m.to] = isCapture
        // Capture: ring around the piece (hollow circle overlay)
        ? { background: "radial-gradient(circle, transparent 58%, rgba(0,0,0,0.35) 58%, rgba(0,0,0,0.35) 68%, transparent 68%)" }
        // Empty: small filled dot in centre
        : { background: "radial-gradient(circle, rgba(0,0,0,0.28) 26%, transparent 26%)" };
    });
    return styles;
  }

  // ── onDragBegin — show legal moves on drag start ──────────
  function onDragBegin(piece, sq) {
    setSquareStyles(getLegalStyles(sq));
  }

  // ── onSquareClick — click/touch to move ───────────────────
  // First click selects a piece and highlights legal moves.
  // Second click on a legal square executes the move.
  // Clicking the same square or an illegal square deselects.
  function onSquareClick(sq) {
    if (statusRef.current !== "active" || !myColorRef.current) return;
    const mine = myColorRef.current === "white" ? "w" : "b";

    // If no square selected yet — try to select this square
    if (!selectedSq) {
      const piece = game.get(sq);
      // Only select own piece on own turn
      if (!piece || piece.color !== mine || piece.color !== game.turn()) return;
      setSelectedSq(sq);
      setSquareStyles(getLegalStyles(sq));
      return;
    }

    // A square is already selected — try to move to clicked square
    if (selectedSq === sq) {
      // Clicked same square: deselect
      setSelectedSq(null);
      setSquareStyles({});
      return;
    }

    // Check if clicked square is a legal destination
    const legalMoves = game.moves({ square: selectedSq, verbose: true });
    const isLegal = legalMoves.some(m => m.to === sq);

    if (isLegal) {
      // Execute the move via existing onDrop logic
      onDrop(selectedSq, sq);
      setSelectedSq(null);
    } else {
      // Maybe clicking another own piece — switch selection
      const piece = game.get(sq);
      if (piece && piece.color === mine && piece.color === game.turn()) {
        setSelectedSq(sq);
        setSquareStyles(getLegalStyles(sq));
      } else {
        // Clicked empty/enemy non-legal square — deselect
        setSelectedSq(null);
        setSquareStyles({});
      }
    }
  }

  // ── onDrop ────────────────────────────────────────────────
  // Called when the player drops a piece on a target square.
  // Validates the move locally with chess.js, then emits it
  // to the server. If invalid, returns false (board snaps back).
  function onDrop(from, to) {
    // Can't move if the game isn't active
    if (status !== "active") {
      setError("⏳ Waiting for opponent…");
      setTimeout(() => setError(null), 2000);
      return false;
    }

    let ok = false;

    setGame(prev => {
      const g = new Chess(prev.fen()); // Clone current state
      try {
        if (g.move({ from, to, promotion: "q" })) { // Always promote to queen
          ok = true;
          setMoveHistory(g.history());
          setSquareStyles({
            [from]: { backgroundColor: "rgba(255,200,0,0.45)" },
            [to]:   { backgroundColor: "rgba(255,200,0,0.45)" },
          });
          // Tell the server about the move — it will broadcast to both players
          socket.emit("move", { roomId, from, to, promotion: "q" });
        }
      } catch {
        setError("❌ Invalid move");
        setTimeout(() => setError(null), 2000);
      }
      return ok ? g : prev; // Only update state if move was valid
    });

    return ok; // react-chessboard uses this to decide whether to animate
  }

  // ── isPieceDraggable ──────────────────────────────────────
  // Prevents dragging opponent's pieces or pieces out of turn.
  // Spectators can never drag anything.
  function isPieceDraggable({ piece }) {
    if (status !== "active" || !myColor) return false;
    const mine = myColor === "white" ? "w" : "b";
    return piece[0] === mine && piece[0] === game.turn();
  }

  // ── handleResign ──────────────────────────────────────────
  // Confirm then tell the server the player resigned.
  function handleResign() {
    if (window.confirm("Resign this game?")) {
      socket.emit("resign", { roomId, color: myColor });
    }
  }

  // ── getStatus ─────────────────────────────────────────────
  // Returns { text, cls } for the status pill above the board.
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

  // Pair moves into rows: [{ n: 1, w: "e4", b: "e5" }, ...]
  const movePairs = [];
  for (let i = 0; i < moveHistory.length; i += 2)
    movePairs.push({ n: i / 2 + 1, w: moveHistory[i], b: moveHistory[i + 1] || "" });

  return (
    <div className="cp-page">

      {/* ═══════════════════════════════
          SIDEBAR — players, move list, theme picker
      ═══════════════════════════════ */}
      <aside className="cp-sidebar">

        {/* Player cards */}
        <div className="cp-card">
          <p className="cp-card-label">PLAYERS</p>

          {/* Render Black first (top of board), then White (bottom) */}
          {[
            { color: "black", letter: "b", symbol: "♟" },
            { color: "white", letter: "w", symbol: "♙" },
          ].map(({ color, letter, symbol }) => (
            <div
              key={color}
              // Highlight the row of whichever player's turn it is
              className={`cp-player-row${game.turn() === letter && status === "active" ? " cp-my-turn" : ""}`}
            >
              <div className={`cp-avatar cp-av-${color}`}>
                {(players[color]?.username || "?")[0].toUpperCase()}
              </div>
              <div className="cp-pinfo">
                <span className="cp-pname">
                  {players[color]?.username || "Waiting…"}
                  {myColor === color && <span className="cp-you">YOU</span>}
                </span>
                <span className="cp-pcolor">{symbol} {color}</span>
              </div>
              {/* Animated green dot next to the active player */}
              {game.turn() === letter && status === "active" && <span className="cp-dot" />}
            </div>
          ))}

          {spectatorCount > 0 && (
            <p className="cp-spec-count">👁 {spectatorCount} watching</p>
          )}
        </div>

        {/* Scrollable move history in algebraic notation */}
        <div className="cp-card cp-moves-card">
          <p className="cp-card-label">MOVES</p>
          <div className="cp-moves">
            {movePairs.length === 0 && <span className="cp-no-moves">No moves yet</span>}
            {movePairs.map(p => (
              <div key={p.n} className="cp-mrow">
                <span className="cp-mn">{p.n}.</span>
                <span className="cp-mw">{p.w}</span>
                <span className="cp-mb">{p.b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Board colour theme swatches */}
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

      {/* ═══════════════════════════════
          MAIN — board + controls
      ═══════════════════════════════ */}
      <main className="cp-main">

        {/* Top bar: home, room code, chat toggle */}
        <div className="cp-topbar">
          <button className="cp-btn cp-home" onClick={() => navigate("/")}>← Home</button>

          {/* Room code display with copy buttons */}
          <div className="cp-code-box">
            <span className="cp-code-label">ROOM</span>
            <span className="cp-code-val">{roomId}</span>
            <button className="cp-icon-btn" onClick={copyCode} title="Copy code">{codeCopied ? "✅" : "📋"}</button>
            <button className="cp-icon-btn" onClick={copyLink} title="Copy link">{copied ? "✅" : "🔗"}</button>
          </div>

          {/* Chat button — shows unread badge when panel is closed */}
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

        {/* Status pill — changes colour based on game state */}
        <div className={`cp-status ${st.cls}`}>{st.text}</div>

        {/* Banner shown only to spectators */}
        {isSpectator && (
          <div className="cp-spec-banner">
            👁 Spectating — you can watch but not move pieces
          </div>
        )}

        {/* Error toast — auto-dismisses after 3 seconds */}
        {error && <div className="cp-error-toast">{error}</div>}

        {/* Chess board */}
        <div className="cp-board">
          <Chessboard
            position={game.fen()}                   // Current board position as FEN string
            onPieceDrop={onDrop}                    // Called when a drag-drop move is attempted
            onPieceDragBegin={onDragBegin}           // Highlights legal squares on drag start
            onPieceDragEnd={() => { setSquareStyles({}); setSelectedSq(null); }}
            onSquareClick={onSquareClick}               // Click/touch to move (mobile friendly)
            areArrowsAllowed={false}                    // disable right-click arrows (cleaner)
            customSquareStyles={squareStyles}        // Highlight last move + legal squares
            isDraggablePiece={isPieceDraggable}      // Only allow player to drag their own pieces
            boardWidth={boardWidth}                  // Responsive — calculated from available space
            boardOrientation={myColor || "white"}    // Flip board for Black player
            customDarkSquareStyle={{ backgroundColor: themes[boardTheme].dark }}
            customLightSquareStyle={{ backgroundColor: themes[boardTheme].light }}
          />
        </div>

        {/* Bottom action buttons */}
        <div className="cp-bottom">
          {status === "active" && myColor && (
            <button className="cp-btn cp-resign" onClick={handleResign}>🏳️ Resign</button>
          )}
          {status === "finished" && (
            <button className="cp-btn cp-home" onClick={() => navigate("/")}>🏠 Back to Lobby</button>
          )}
        </div>
      </main>

      {/* ═══════════════════════════════
          PANEL — chat + voice (rendered when showPanel is true)
      ═══════════════════════════════ */}
      {showPanel && (
        <ChatVoicePanel roomId={roomId} username={username} isOpen={showPanel} />
      )}
    </div>
  );
}

export default ChessPage;