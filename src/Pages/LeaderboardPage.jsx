// src/Pages/LeaderboardPage.jsx — Feature 4: ELO leaderboard
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import "./LeaderboardPage.css";

function LeaderboardPage() {
  const navigate = useNavigate();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const me = JSON.parse(localStorage.getItem("user") || "{}");

  useEffect(() => {
    api.leaderboard()
      .then(d => setUsers(d.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="lb-page">
      <div className="lb-card">
        <button className="lb-back" onClick={() => navigate("/")}>← Back</button>
        <h1 className="lb-title">🏆 Leaderboard</h1>
        <p className="lb-sub">Top players by ELO rating</p>

        {loading && <p className="lb-loading">Loading…</p>}

        {!loading && users.length === 0 && (
          <p className="lb-empty">No ranked players yet. Play a game!</p>
        )}

        <div className="lb-list">
          {users.map((u, i) => (
            <div key={u._id} className={`lb-row${u.username === me.username ? " lb-me" : ""}`}>
              <span className="lb-rank">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
              </span>
              <span className="lb-name">{u.username} {u.username === me.username && <span className="lb-you">YOU</span>}</span>
              <span className="lb-elo">{u.eloRating}</span>
              <span className="lb-record">{u.wins}W / {u.losses}L</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default LeaderboardPage;
