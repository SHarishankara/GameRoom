// src/App.jsx
// ─────────────────────────────────────────────────────────────
// Root component. Defines all routes and the Home lobby screen.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import "./App.css";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import ChessPage from "./Pages/ChessPage.jsx";
import AuthPage from "./Pages/AuthPage.jsx";
import JoinPage from "./Pages/JoinPage.jsx";
import { api } from "./services/api"; // Centralised fetch helper — no hardcoded URLs

// ── ProtectedRoute ─────────────────────────────────────────
// Wraps any route that requires the user to be logged in.
// If there's no token in localStorage, redirect to /auth.
function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/auth" replace />;
  return children;
}

// ── Home ───────────────────────────────────────────────────
// The game lobby: shows available games, search, and filters.
// Only Chess has working room actions right now.
function Home() {
  const navigate = useNavigate();

  // Pull saved user info and token from localStorage (set at login)
  const user  = JSON.parse(localStorage.getItem("user") || "{}");
  const token = localStorage.getItem("token");

  const [searchTerm, setSearchTerm]   = useState("");
  const [filter, setFilter]           = useState("all");
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Full game catalogue — only Chess is functional for now
  const allGames = [
    { name: "Chess",          info: "2 players, up to 10 spectators",              trending: true,  mutual: false },
    { name: "Snake and Ladder", info: "8 players, up to 10 spectators",            trending: true,  mutual: true  },
    { name: "Carrom",         info: "4 players, up to 10 spectators",              trending: false, mutual: true  },
    { name: "Ludo",           info: "4 players, up to 10 spectators",              trending: true,  mutual: false },
    { name: "Business",       info: "5 players + 1 cashier, up to 10 spectators", trending: false, mutual: true  },
  ];

  // Filter by search text AND selected tab (trending / mutual / all)
  const filteredGames = allGames.filter((game) => {
    const matchSearch = game.name.toLowerCase().includes(searchTerm.toLowerCase());
    if (filter === "trending") return game.trending && matchSearch;
    if (filter === "mutual")   return game.mutual   && matchSearch;
    return matchSearch;
  });

  // ── Create Room ──────────────────────────────────────────
  // Calls the backend to create a new chess room, then
  // navigates to that room's URL so White is ready.
  async function handleCreateRoom() {
    setCreatingRoom(true);
    try {
      const data = await api.createRoom(token);
      if (data.roomId) {
        navigate(`/chess/${data.roomId}`);
      } else {
        alert("Failed: " + data.message);
      }
    } catch {
      alert("Server error. Is backend running?");
    }
    setCreatingRoom(false);
  }

  // ── Logout ───────────────────────────────────────────────
  // Clear stored credentials and send to auth page.
  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/auth");
  }

  return (
    <div className="screen">
      {/* Top bar: username + logout */}
      <div className="user-bar">
        <span>👤 {user.username}</span>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>

      {/* Search input filters the game list below */}
      <input
        type="text"
        placeholder="Find a game..."
        className="search"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      {/* Filter tabs */}
      <div className="filter-name">
        <button onClick={() => setFilter("trending")}>Trending</button>
        <button onClick={() => setFilter("mutual")}>Mutual</button>
        <button onClick={() => setFilter("all")}>All</button>
      </div>

      {/* Game cards */}
      <div className="games">
        {filteredGames.length > 0 ? (
          filteredGames.map((game, index) => (
            <div key={index} className="game">
              <div className="game-name">{game.name}</div>
              <div className="game-info">{game.info}</div>

              {/* Only Chess has room actions wired up */}
              {game.name === "Chess" && (
                <div className="game-actions">
                  <button
                    className="create-room-btn"
                    onClick={handleCreateRoom}
                    disabled={creatingRoom}
                  >
                    {creatingRoom ? "Creating..." : "♟ Create Room"}
                  </button>
                  <button
                    className="join-room-btn"
                    onClick={() => navigate("/join")}
                  >
                    🔑 Join with Code
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

// ── App ────────────────────────────────────────────────────
// Route table. ProtectedRoute guards anything that needs login.
function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/auth" element={<AuthPage />} />

      {/* Protected */}
      <Route path="/join"           element={<ProtectedRoute><JoinPage /></ProtectedRoute>} />
      <Route path="/"               element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/chess/:roomId"  element={<ProtectedRoute><ChessPage /></ProtectedRoute>} />

      {/* Catch-all: redirect unknown URLs to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;