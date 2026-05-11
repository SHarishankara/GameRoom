// src/Pages/MatchmakingPage.jsx — Feature 5: Find Match UI
// Shows a pulsing "searching" screen. Socket events handle matching.
// When match-found fires → navigate to the chess room.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { socket, connectSocket } from "../services/socket";
import { api } from "../services/api";
import "./MatchmakingPage.css";

function MatchmakingPage() {
  const navigate = useNavigate();
  const user     = JSON.parse(localStorage.getItem("user") || "{}");
  const token    = localStorage.getItem("token");

  const [status, setStatus]       = useState("idle");   // idle | queued | found
  const [queueSize, setQueueSize] = useState(0);
  const [elapsed, setElapsed]     = useState(0);
  const [matchInfo, setMatchInfo] = useState(null);
  const timerRef = useRef(null);

  // Poll queue size every 5 seconds so user sees demand
  useEffect(() => {
    fetchQueueSize();
    const iv = setInterval(fetchQueueSize, 5000);
    return () => clearInterval(iv);
  }, []);

  async function fetchQueueSize() {
    try {
      const data = await api.queueSize();
      setQueueSize(data.size || 0);
    } catch {}
  }

  // Socket: listen for match-found
  useEffect(() => {
    connectSocket();

    const onMatchFound = ({ roomId, color, opponent, opponentElo }) => {
      setMatchInfo({ roomId, color, opponent, opponentElo });
      setStatus("found");
      clearInterval(timerRef.current);
      // Navigate after 2s so user can read the match info
      setTimeout(() => navigate(`/chess/${roomId}`), 2000);
    };

    socket.on("match-found", onMatchFound);
    return () => {
      socket.off("match-found", onMatchFound);
      // Don't leave queue here — user may just be navigating within the page
    };
  }, [navigate]);

  // Elapsed time counter while queued
  useEffect(() => {
    if (status === "queued") {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      if (status === "idle") setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  function handleFindMatch() {
    setStatus("queued");
    socket.emit("queue-join");
  }

  function handleCancel() {
    socket.emit("queue-leave");
    setStatus("idle");
    setElapsed(0);
  }

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  return (
    <div className="mm-page">
      <button className="mm-back" onClick={() => { handleCancel(); navigate("/"); }}>← Back</button>

      <div className="mm-card">
        <div className="mm-icon">⚔️</div>
        <h1 className="mm-title">Find a Match</h1>
        <p className="mm-elo">Your ELO: <strong>{user.eloRating ?? 1200}</strong></p>
        <p className="mm-queue-info">{queueSize} player{queueSize !== 1 ? "s" : ""} searching</p>

        {status === "idle" && (
          <button className="mm-btn" onClick={handleFindMatch}>🔍 Find Match</button>
        )}

        {status === "queued" && (
          <div className="mm-searching">
            <div className="mm-pulse" />
            <p className="mm-wait">Searching… {fmt(elapsed)}</p>
            <p className="mm-hint">Matching you with a player near your ELO</p>
            <button className="mm-cancel" onClick={handleCancel}>✕ Cancel</button>
          </div>
        )}

        {status === "found" && matchInfo && (
          <div className="mm-found">
            <p className="mm-found-text">Match found!</p>
            <p>vs <strong>{matchInfo.opponent}</strong> (ELO {matchInfo.opponentElo})</p>
            <p>You play as <strong>{matchInfo.color}</strong></p>
            <p className="mm-redirect">Redirecting…</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default MatchmakingPage;
