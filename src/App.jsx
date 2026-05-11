// src/App.jsx
// Changes vs original:
//   - Added routes: /matchmaking, /leaderboard, /friends, /auth/callback
//   - Feature 6: /chess/:roomId checks auth and stores pendingRoom in sessionStorage
//   - Home: added Find Match + Leaderboard + Friends buttons
//   - Home: shows ELO in user bar
//   - ALL existing logic is unchanged

import { useState } from "react";
import "./App.css";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import ChessPage        from "./pages/ChessPage.jsx";
import AuthPage, { OAuthCallback } from "./pages/AuthPage.jsx";
import JoinPage         from "./pages/JoinPage.jsx";
import MatchmakingPage  from "./pages/MatchmakingPage.jsx";
import LeaderboardPage  from "./pages/LeaderboardPage.jsx";
import FriendsPage      from "./pages/FriendsPage.jsx";
import { api }          from "./services/api";

// ── ProtectedRoute (unchanged) ────────────────────────────────
function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/auth" replace />;
  return children;
}

// ── Feature 6: InviteRoute ────────────────────────────────────
// Handles /chess/:roomId when user is NOT logged in.
// Saves the roomId so AuthPage redirects back after login.
function InviteRoute() {
  const { roomId } = useParams();
  const token      = localStorage.getItem("token");

  if (!token) {
    // Store room to return to after login
    sessionStorage.setItem("pendingRoom", roomId);
    return <Navigate to="/auth" replace />;
  }
  return <ChessPage />;
}

// ── Home ──────────────────────────────────────────────────────
function Home() {
  const navigate = useNavigate();
  const user     = JSON.parse(localStorage.getItem("user") || "{}");
  const token    = localStorage.getItem("token");

  const [searchTerm, setSearchTerm]     = useState("");
  const [filter, setFilter]             = useState("all");
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Unchanged game catalogue
  const allGames = [
    { name: "Chess",           info: "2 players, up to 10 spectators",              trending: true,  mutual: false },
    { name: "Snake and Ladder",info: "8 players, up to 10 spectators",              trending: true,  mutual: true  },
    { name: "Carrom",          info: "4 players, up to 10 spectators",              trending: false, mutual: true  },
    { name: "Ludo",            info: "4 players, up to 10 spectators",              trending: true,  mutual: false },
    { name: "Business",        info: "5 players + 1 cashier, up to 10 spectators", trending: false, mutual: true  },
  ];

  const filteredGames = allGames.filter((game) => {
    const matchSearch = game.name.toLowerCase().includes(searchTerm.toLowerCase());
    if (filter === "trending") return game.trending && matchSearch;
    if (filter === "mutual")   return game.mutual   && matchSearch;
    return matchSearch;
  });

  async function handleCreateRoom() {
    setCreatingRoom(true);
    try {
      const data = await api.createRoom(token);
      if (data.roomId) navigate(`/chess/${data.roomId}`);
      else alert("Failed: " + data.message);
    } catch { alert("Server error. Is backend running?"); }
    setCreatingRoom(false);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/auth");
  }

  return (
    <div className="screen">
      {/* Top bar — now shows ELO + nav buttons */}
      <div className="user-bar">
        <span>
          👤 {user.username}
          {/* Feature 4: show ELO */}
          {user.eloRating && (
            <span className="user-elo"> · ⚡{user.eloRating}</span>
          )}
        </span>
        <div className="user-bar-actions">
          <button className="nav-btn" onClick={() => navigate("/leaderboard")} title="Leaderboard">🏆</button>
          <button className="nav-btn" onClick={() => navigate("/friends")}     title="Friends">👥</button>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Find a game..."
        className="search"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      <div className="filter-name">
        <button onClick={() => setFilter("trending")}>Trending</button>
        <button onClick={() => setFilter("mutual")}>Mutual</button>
        <button onClick={() => setFilter("all")}>All</button>
      </div>

      <div className="games">
        {filteredGames.length > 0 ? (
          filteredGames.map((game, index) => (
            <div key={index} className="game">
              <div className="game-name">{game.name}</div>
              <div className="game-info">{game.info}</div>

              {game.name === "Chess" && (
                <div className="game-actions">
                  <button className="create-room-btn" onClick={handleCreateRoom} disabled={creatingRoom}>
                    {creatingRoom ? "Creating..." : "♟ Create Room"}
                  </button>
                  <button className="join-room-btn" onClick={() => navigate("/join")}>
                    🔑 Join with Code
                  </button>
                  {/* Feature 5: Find Match button */}
                  <button className="find-match-btn" onClick={() => navigate("/matchmaking")}>
                    ⚔️ Find Match
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="no-result">No games found</p>
        )}
      </div>
    </div>
  );
}

// ── App (route table) ─────────────────────────────────────────
function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/auth"          element={<AuthPage />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />  {/* Feature 3: Google OAuth return */}

      {/* Protected */}
      <Route path="/"              element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/join"          element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
      <Route path="/matchmaking"   element={<ProtectedRoute><MatchmakingPage /></ProtectedRoute>} />   {/* Feature 5 */}
      <Route path="/leaderboard"   element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />   {/* Feature 4 */}
      <Route path="/friends"       element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />        {/* Friends */}

      {/* Feature 6: invite link — handles unauthenticated users gracefully */}
      <Route path="/chess/:roomId" element={<InviteRoute />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;