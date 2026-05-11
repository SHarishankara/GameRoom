// src/Pages/AuthPage.jsx
// Changes: Google OAuth button (Feature 3) + sessionStorage room redirect (Feature 6)
// All existing login/register logic is UNCHANGED.
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { connectSocket } from "../services/socket";
import "./AuthPage.css";

function AuthPage() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode]     = useState("login");
  const [form, setForm]     = useState({ username: "", email: "", password: "" });
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  // ── Feature 6: Check for OAuth error param ─────────────────
  useEffect(() => {
    if (searchParams.get("error") === "google") {
      setError("Google login failed. Please try again.");
    }
  }, [searchParams]);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError(null);
  }

  // ── Shared: save token + user, connect socket, redirect ────
  function finishLogin(token, user) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    connectSocket();
    // Feature 6: if user was redirected here from an invite link,
    // sessionStorage holds the target room → go there after login
    const pendingRoom = sessionStorage.getItem("pendingRoom");
    if (pendingRoom) {
      sessionStorage.removeItem("pendingRoom");
      navigate(`/chess/${pendingRoom}`);
    } else {
      navigate("/");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let data;
      if (mode === "register") {
        if (!form.username || !form.email || !form.password) {
          setError("All fields are required."); setLoading(false); return;
        }
        data = await api.register({ username: form.username, email: form.email, password: form.password });
      } else {
        if (!form.email || !form.password) {
          setError("Email and password are required."); setLoading(false); return;
        }
        data = await api.login({ email: form.email, password: form.password });
      }
      if (data.token) finishLogin(data.token, data.user);
      else setError(data.message || "Something went wrong.");
    } catch { setError("Server error. Is the backend running?"); }
    setLoading(false);
  }

  // ── Feature 3: Google OAuth — redirect to backend ──────────
  function handleGoogleLogin() {
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
    window.location.href = `${apiUrl}/api/auth/google`;
  }

  return (
    <div className="auth-bg">
      <div className="auth-pieces">
        <span>♟</span><span>♜</span><span>♞</span>
        <span>♝</span><span>♛</span><span>♚</span>
      </div>

      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">♟</span>
          <h1>GameRoom</h1>
          <p>Play. Talk. Connect.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(null); }}>Login</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(null); }}>Register</button>
        </div>

        {/* Feature 3: Google login button */}
        <button className="auth-google-btn" onClick={handleGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.1 0 5.8 1.1 8 2.9l6-6C34.5 3.2 29.6 1 24 1 14.8 1 7 6.7 3.7 14.6l7 5.4C12.5 13.8 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.2-9.9 6.2-16.9z"/><path fill="#FBBC05" d="M10.7 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7-5.4A23.5 23.5 0 0 0 .5 24c0 3.9.9 7.6 2.6 10.8l7.6-6.2z"/><path fill="#34A853" d="M24 46.5c5.5 0 10.2-1.8 13.6-4.9l-7.4-5.7c-1.9 1.3-4.4 2.1-6.2 2.1-6.1 0-11.3-4.1-13.2-9.7l-7.6 6.2C7.1 41 14.9 46.5 24 46.5z"/></svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "register" && (
            <div className="auth-field">
              <label>Username</label>
              <input type="text" name="username" placeholder="e.g. ChessMaster7" value={form.username} onChange={handleChange} autoComplete="off" />
            </div>
          )}
          <div className="auth-field">
            <label>Email</label>
            <input type="email" name="email" placeholder="you@email.com" value={form.email} onChange={handleChange} autoComplete="off" />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <input type="password" name="password" placeholder="••••••••" value={form.password} onChange={handleChange} />
          </div>
          {error && <p className="auth-error">⚠ {error}</p>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Login →" : "Create Account →"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <span onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "Register" : "Login"}
          </span>
        </p>
      </div>
    </div>
  );
}

// ── OAuthCallback — handles /auth/callback?token=...&user=... ──
// Google redirects to this after successful login.
// Reads token from URL, saves it, then navigates home (or to pending room).
export function OAuthCallback() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);

  useEffect(() => {
    const token    = searchParams.get("token");
    const userRaw  = searchParams.get("user");
    const redirect = searchParams.get("redirect") || "/";

    if (!token || !userRaw) {
      setError("Login failed. Please try again.");
      return;
    }
    try {
      const user = JSON.parse(decodeURIComponent(userRaw));
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
      connectSocket();
      // Feature 6: respect pending room
      const pendingRoom = sessionStorage.getItem("pendingRoom");
      if (pendingRoom) {
        sessionStorage.removeItem("pendingRoom");
        navigate(`/chess/${pendingRoom}`, { replace: true });
      } else {
        navigate(decodeURIComponent(redirect) || "/", { replace: true });
      }
    } catch {
      setError("Login failed. Please try again.");
    }
  }, []);

  if (error) return <div style={{color:"#fff",textAlign:"center",marginTop:"40vh"}}>{error}</div>;
  return <div style={{color:"#fff",textAlign:"center",marginTop:"40vh"}}>Logging you in…</div>;
}

export default AuthPage;