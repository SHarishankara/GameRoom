// src/Pages/JoinPage.jsx
// ─────────────────────────────────────────────────────────────
// Page where a player enters a 6-character room code to join
// a friend's existing game. Validates the room exists and
// isn't finished before navigating to the chess board.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api"; // Uses env-aware base URL — no hardcoded localhost
import "./JoinPage.css";

function JoinPage() {
  const navigate = useNavigate();

  const [code, setCode]       = useState("");
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  // ── handleJoin ─────────────────────────────────────────────
  // 1. Validates the code isn't empty
  // 2. Asks the backend if the room exists and is still active
  // 3. Navigates to /chess/:roomId if everything checks out
  async function handleJoin() {
    const trimmed = code.trim().toUpperCase();

    if (!trimmed) {
      setError("Please enter a room code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check room status before navigating — avoids joining dead rooms
      const data = await api.getRoom(trimmed);

      if (!data.roomId) {
        setError("Room not found. Check the code and try again.");
        setLoading(false);
        return;
      }

      // Don't let a third player join a finished game
      if (data.status === "finished") {
        setError("This game has already ended.");
        setLoading(false);
        return;
      }

      // Room is valid → go to the chess board
      navigate(`/chess/${trimmed}`);
    } catch {
      setError("Server error. Is the backend running?");
    }

    setLoading(false);
  }

  // Allow pressing Enter to submit instead of clicking the button
  function handleKeyDown(e) {
    if (e.key === "Enter") handleJoin();
  }

  return (
    <div className="join-bg">
      {/* Decorative floating chess pieces in the background */}
      <div className="join-pieces">
        <span>♟</span><span>♜</span><span>♞</span><span>♝</span>
      </div>

      <div className="join-card">
        {/* Header */}
        <div className="join-logo">
          <span className="join-logo-icon">♟</span>
          <h1>Join a Game</h1>
          <p>Enter the room code your friend shared</p>
        </div>

        {/* Room code input — uppercase, max 6 chars, styled like a BGMI room code */}
        <input
          type="text"
          className="code-input"
          placeholder="e.g. A3F9B2"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          maxLength={6}
          autoFocus
          autoComplete="off"
        />

        {/* Error message shown if room lookup fails */}
        {error && <p className="join-error">⚠ {error}</p>}

        <button className="join-btn" onClick={handleJoin} disabled={loading}>
          {loading ? "Checking..." : "Join Room →"}
        </button>

        <button className="back-btn" onClick={() => navigate("/")}>
          ← Back to Home
        </button>
      </div>
    </div>
  );
}

export default JoinPage;