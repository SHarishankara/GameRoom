import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { connectSocket } from "../services/socket";
import "./AuthPage.css";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let data;

      if (mode === "register") {
        if (!form.username || !form.email || !form.password) {
          setError("All fields are required.");
          setLoading(false);
          return;
        }
        data = await api.register({
          username: form.username,
          email: form.email,
          password: form.password,
        });
      } else {
        if (!form.email || !form.password) {
          setError("Email and password are required.");
          setLoading(false);
          return;
        }
        data = await api.login({
          email: form.email,
          password: form.password,
        });
      }

      if (data.token) {
        // Save to localStorage
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        connectSocket(); // Start real-time connection
        navigate("/");   // Go to home
      } else {
        setError(data.message || "Something went wrong.");
      }
    } catch (err) {
      setError("Server error. Is the backend running?");
    }

    setLoading(false);
  }

  return (
    <div className="auth-bg">
      {/* Floating chess pieces decoration */}
      <div className="auth-pieces">
        <span>♟</span><span>♜</span><span>♞</span>
        <span>♝</span><span>♛</span><span>♚</span>
      </div>

      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <span className="auth-logo-icon">♟</span>
          <h1>GameRoom</h1>
          <p>Play. Talk. Connect.</p>
        </div>

        {/* Tab Toggle */}
        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => { setMode("login"); setError(null); }}
          >
            Login
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => { setMode("register"); setError(null); }}
          >
            Register
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "register" && (
            <div className="auth-field">
              <label>Username</label>
              <input
                type="text"
                name="username"
                placeholder="e.g. ChessMaster7"
                value={form.username}
                onChange={handleChange}
                autoComplete="off"
              />
            </div>
          )}

          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              name="email"
              placeholder="you@email.com"
              value={form.email}
              onChange={handleChange}
              autoComplete="off"
            />
          </div>

          <div className="auth-field">
            <label>Password</label>
            <input
              type="password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          {error && <p className="auth-error">⚠ {error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Login →"
              : "Create Account →"}
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

export default AuthPage;
