package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	sessionCookie = "arutosio_session"
	csrfHeader    = "X-Arutosio-CSRF"
	sessionTTL    = 30 * 24 * time.Hour
)

type session struct {
	csrf    string
	expires time.Time
}

type persistedSession struct {
	CSRF    string    `json:"csrf"`
	Expires time.Time `json:"expires"`
}

// Sessions are persisted so a self-update (which re-execs the daemon) does not
// log the browser out. The file lives in the 0700 data dir with mode 0600.
func (s *server) loadSessions() {
	if s.sessionFile == "" {
		return
	}
	raw, err := os.ReadFile(s.sessionFile)
	if err != nil {
		return
	}
	var data map[string]persistedSession
	if err := json.Unmarshal(raw, &data); err != nil {
		log.Printf("sessions: ignoring %s: %v", s.sessionFile, err)
		return
	}
	if s.sessions == nil {
		s.sessions = make(map[string]session)
	}
	now := time.Now()
	for id, p := range data {
		if id == "" || p.CSRF == "" || now.After(p.Expires) {
			continue
		}
		s.sessions[id] = session{csrf: p.CSRF, expires: p.Expires}
	}
}

func (s *server) saveSessionsLocked() {
	if s.sessionFile == "" {
		return
	}
	data := make(map[string]persistedSession, len(s.sessions))
	for id, ses := range s.sessions {
		data[id] = persistedSession{CSRF: ses.csrf, Expires: ses.expires}
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	tmp := s.sessionFile + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		log.Printf("sessions: write: %v", err)
		return
	}
	if err := os.Rename(tmp, s.sessionFile); err != nil {
		log.Printf("sessions: rename: %v", err)
	}
}

type authInfo struct {
	cookie bool
	csrf   string
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (s *server) newSession() (string, session) {
	id := randomHex(32)
	ses := session{csrf: randomHex(32), expires: time.Now().Add(sessionTTL)}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sessions == nil {
		s.sessions = make(map[string]session)
	}
	for k, v := range s.sessions {
		if now.After(v.expires) {
			delete(s.sessions, k)
		}
	}
	s.sessions[id] = ses
	s.saveSessionsLocked()
	return id, ses
}

func (s *server) getSession(id string) (session, bool) {
	if id == "" {
		return session{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ses, ok := s.sessions[id]
	if !ok {
		return session{}, false
	}
	if time.Now().After(ses.expires) {
		delete(s.sessions, id)
		return session{}, false
	}
	return ses, true
}

func (s *server) deleteSession(id string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	delete(s.sessions, id)
	s.saveSessionsLocked()
	s.mu.Unlock()
}

func (s *server) authenticate(r *http.Request) (authInfo, bool) {
	if token := tokenFromRequest(r); token != "" {
		if subtle.ConstantTimeCompare([]byte(token), []byte(s.token)) == 1 {
			return authInfo{}, true
		}
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return authInfo{}, false
	}
	ses, ok := s.getSession(c.Value)
	if !ok {
		return authInfo{}, false
	}
	return authInfo{cookie: true, csrf: ses.csrf}, true
}

func tokenFromRequest(r *http.Request) string {
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

func (s *server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ai, ok := s.authenticate(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if ai.cookie && isMutating(r.Method) {
			if r.Header.Get(csrfHeader) != ai.csrf {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid csrf token"})
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && !originAllowed(origin, r.Host) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin not allowed"})
				return
			}
		}
		next(w, r)
	}
}

func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	remote := remoteHost(r.RemoteAddr)
	if !s.loginAllowed(remote) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts"})
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Token), []byte(s.token)) != 1 {
		s.recordFailure(remote)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
		return
	}
	s.clearFailures(remote)
	id, ses := s.newSession()
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPS(r),
		MaxAge:   int(sessionTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"csrf":          ses.csrf,
		"expires":       ses.expires,
	})
}

func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ai, ok := s.authenticate(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"authenticated": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"csrf":          ai.csrf,
		"cookie":        ai.cookie,
	})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.deleteSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPS(r),
		MaxAge:   -1,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) loginAllowed(remote string) bool {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failures == nil {
		s.failures = make(map[string][]time.Time)
	}
	recent := s.failures[remote][:0]
	for _, t := range s.failures[remote] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) == 0 {
		delete(s.failures, remote)
	} else {
		s.failures[remote] = recent
	}
	return len(recent) < 8
}

func (s *server) recordFailure(remote string) {
	s.mu.Lock()
	if s.failures == nil {
		s.failures = make(map[string][]time.Time)
	}
	s.failures[remote] = append(s.failures[remote], time.Now())
	s.mu.Unlock()
}

func (s *server) clearFailures(remote string) {
	s.mu.Lock()
	delete(s.failures, remote)
	s.mu.Unlock()
}

func remoteHost(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func originAllowed(origin, host string) bool {
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return u.Host == host && (u.Scheme == "http" || u.Scheme == "https")
}
