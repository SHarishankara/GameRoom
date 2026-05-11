// src/pages/FriendsPage.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import "./FriendsPage.css";

function FriendsPage() {
  const navigate = useNavigate();
  const token    = localStorage.getItem("token");
  const [friends, setFriends]   = useState([]);
  const [requests, setRequests] = useState([]);
  const [search, setSearch]     = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [msg, setMsg]           = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [f, r] = await Promise.all([api.getFriends(token), api.getFriendRequests(token)]);
      setFriends(f.friends || []);
      setRequests(r.requests || []);
    } catch {}
    setLoading(false);
  }

  async function handleSearch() {
    if (!search.trim()) return;
    try {
      const data = await api.profile(search.trim());
      setSearchResult(data.user || null);
      if (!data.user) setMsg("User not found.");
    } catch { setMsg("Error searching."); }
  }

  async function handleSendRequest(userId) {
    const data = await api.sendFriendRequest(token, userId);
    setMsg(data.message);
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleAccept(userId) {
    await api.acceptFriend(token, userId);
    load();
  }

  async function handleRemove(userId) {
    await api.removeFriend(token, userId);
    load();
  }

  return (
    <div className="fr-page">
      <div className="fr-card">
        <button className="fr-back" onClick={() => navigate("/")}>← Back</button>
        <h1 className="fr-title">👥 Friends</h1>

        {/* Search */}
        <div className="fr-search-row">
          <input className="fr-input" placeholder="Search username…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSearch()} />
          <button className="fr-btn-orange" onClick={handleSearch}>Search</button>
        </div>

        {msg && <p className="fr-msg">{msg}</p>}

        {searchResult && (
          <div className="fr-result">
            <span className="fr-rname">{searchResult.username}</span>
            <span className="fr-relo">ELO {searchResult.eloRating}</span>
            <button className="fr-btn-sm" onClick={() => handleSendRequest(searchResult._id)}>Add Friend</button>
          </div>
        )}

        {/* Incoming requests */}
        {requests.length > 0 && (
          <>
            <p className="fr-section">Requests ({requests.length})</p>
            {requests.map(u => (
              <div key={u._id} className="fr-row">
                <span className="fr-name">{u.username}</span>
                <span className="fr-elo">ELO {u.eloRating}</span>
                <button className="fr-btn-sm green" onClick={() => handleAccept(u._id)}>Accept</button>
              </div>
            ))}
          </>
        )}

        {/* Friends list */}
        <p className="fr-section">Friends ({friends.length})</p>
        {loading && <p className="fr-empty">Loading…</p>}
        {!loading && friends.length === 0 && <p className="fr-empty">No friends yet. Search to add someone!</p>}
        {friends.map(u => (
          <div key={u._id} className="fr-row">
            <div className="fr-av">{u.username[0].toUpperCase()}</div>
            <div className="fr-info">
              <span className="fr-name">{u.username}</span>
              <span className="fr-elo">ELO {u.eloRating} · {u.wins}W {u.losses}L</span>
            </div>
            <button className="fr-btn-sm red" onClick={() => handleRemove(u._id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FriendsPage;
