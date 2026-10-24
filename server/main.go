// arutosiod — local daemon for Arutosio OS.
//
// It serves the static site, a filesystem API, a server-side profile/session
// store and a PTY over WebSocket. Bound to loopback by default; treat the
// token like an SSH credential, because the terminal is a full user shell.
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

var version = "0.4.0"

//go:embed web/*
var termFS embed.FS

type server struct {
	root       string
	web        string
	dataDir    string
	profileDir string
	trashDir   string
	token      string

	mu          sync.Mutex
	sessions    map[string]session
	sessionFile string
	failures    map[string][]time.Time

	termMu   sync.Mutex
	terms    map[string]*termSession
	termIdle time.Duration

	updateState
}

func main() {
	listen := flag.String("listen", "127.0.0.1:7777", "listen address")
	web := flag.String("web", "..", "directory containing the static site")
	root := flag.String("root", "", "filesystem root (default: $HOME)")
	data := flag.String("data", "", "data directory (default: ~/.arutosio)")
	token := flag.String("token", "", "access token (default: persisted in the data dir)")
	termIdle := flag.Duration("term-idle", 24*time.Hour, "kill detached terminal sessions after this idle time (0 = never)")
	updateURL := flag.String("update-url", defaultUpdateURL, "latest-release JSON URL for update checks (blank disables)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	rootAbs, err := resolveRoot(*root)
	if err != nil {
		log.Fatalf("root: %v", err)
	}
	webAbs, err := filepath.Abs(*web)
	if err != nil {
		log.Fatalf("web: %v", err)
	}
	if st, err := os.Stat(webAbs); err != nil || !st.IsDir() {
		log.Fatalf("web: %s is not a directory", webAbs)
	}
	dataAbs, err := resolveData(*data)
	if err != nil {
		log.Fatalf("data: %v", err)
	}
	tokenValue, err := loadOrCreateToken(dataAbs, *token)
	if err != nil {
		log.Fatalf("token: %v", err)
	}
	profileDir := filepath.Join(dataAbs, "profile")
	trashDir := filepath.Join(dataAbs, "trash")
	for _, dir := range []string{profileDir, filepath.Join(profileDir, "apps"), filepath.Join(profileDir, "sessions"), filepath.Join(profileDir, "appearance"), trashDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Fatalf("data dir: %v", err)
		}
	}

	termSub, err := fs.Sub(termFS, "web")
	if err != nil {
		log.Fatalf("embedded terminal assets: %v", err)
	}

	s := &server{
		root:        rootAbs,
		web:         webAbs,
		dataDir:     dataAbs,
		profileDir:  profileDir,
		trashDir:    trashDir,
		token:       tokenValue,
		sessions:    make(map[string]session),
		sessionFile: filepath.Join(dataAbs, "sessions.json"),
		failures:    make(map[string][]time.Time),
		terms:       make(map[string]*termSession),
		termIdle:    *termIdle,
		updateState: updateState{
			updateURL:    *updateURL,
			updateClient: &http.Client{},
		},
	}
	s.loadSessions()
	s.cleanupUpdateLeftovers()
	go s.cleanupTerms()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/session", s.handleSession)
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/auth/logout", s.handleLogout)

	mux.HandleFunc("/api/fs/roots", s.withAuth(s.handleFSRoots))
	mux.HandleFunc("/api/fs/list", s.withAuth(s.handleFSList))
	mux.HandleFunc("/api/fs/stat", s.withAuth(s.handleFSStat))
	mux.HandleFunc("/api/fs/read", s.withAuth(s.handleFSRead))
	mux.HandleFunc("/api/fs/download", s.withAuth(s.handleFSDownload))
	mux.HandleFunc("/api/fs/write", s.withAuth(s.handleFSWrite))
	mux.HandleFunc("/api/fs/upload", s.withAuth(s.handleFSUpload))
	mux.HandleFunc("/api/fs/mkdir", s.withAuth(s.handleFSMkdir))
	mux.HandleFunc("/api/fs/rename", s.withAuth(s.handleFSRename))
	mux.HandleFunc("/api/fs/delete", s.withAuth(s.handleFSDelete))

	mux.HandleFunc("/api/profile/localStorage", s.withAuth(s.handleProfileLocalStorage))
	mux.HandleFunc("/api/profile/apps/", s.withAuth(s.handleProfileApp))
	mux.HandleFunc("/api/profile/session/", s.withAuth(s.handleProfileSession))
	mux.HandleFunc("/api/profile/appearance/", s.withAuth(s.handleProfileAppearance))
	mux.HandleFunc("/api/profile/export", s.withAuth(s.handleProfileExport))

	mux.HandleFunc("/api/system/info", s.withAuth(s.handleSystemInfo))
	mux.HandleFunc("/api/system/processes", s.withAuth(s.handleSystemProcesses))
	mux.HandleFunc("/api/system/kill", s.withAuth(s.handleSystemKill))
	mux.HandleFunc("/api/system/services", s.withAuth(s.handleSystemServices))
	mux.HandleFunc("/api/system/service", s.withAuth(s.handleSystemService))
	mux.HandleFunc("/api/system/trash", s.withAuth(s.handleSystemTrash))
	mux.HandleFunc("/api/system/trash/list", s.withAuth(s.handleSystemTrashList))
	mux.HandleFunc("/api/system/trash/restore", s.withAuth(s.handleSystemTrashRestore))
	mux.HandleFunc("/api/system/trash/empty", s.withAuth(s.handleSystemTrashEmpty))
	mux.HandleFunc("/api/system/terms", s.withAuth(s.handleSystemTerms))
	mux.HandleFunc("/api/system/terms/kill", s.withAuth(s.handleSystemTermKill))

	mux.HandleFunc("/api/update", s.withAuth(s.handleUpdateCheck))
	mux.HandleFunc("/api/update/apply", s.withAuth(s.handleUpdateApply))
	mux.HandleFunc("/api/update/rollback", s.withAuth(s.handleUpdateRollback))

	mux.HandleFunc("/ws/term", s.withAuth(s.handleTerm))
	mux.HandleFunc("/term", s.handleTermPage)
	mux.Handle("/term/", http.StripPrefix("/term/", http.FileServer(http.FS(termSub))))
	mux.HandleFunc("/", s.handleSite)

	addr := displayAddr(*listen)
	log.Printf("arutosiod %s", version)
	log.Printf("root: %s", rootAbs)
	log.Printf("web:  %s", webAbs)
	log.Printf("data: %s", dataAbs)
	log.Printf("open: http://%s/?token=%s", addr, tokenValue)
	log.Printf("term: http://%s/term?token=%s", addr, tokenValue)

	srv := &http.Server{
		Addr:              *listen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

func resolveRoot(p string) (string, error) {
	if p == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		p = home
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s is not a directory", abs)
	}
	return abs, nil
}

func resolveData(p string) (string, error) {
	if p == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		p = filepath.Join(home, ".arutosio")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return "", err
	}
	return abs, nil
}

func loadOrCreateToken(dataDir, override string) (string, error) {
	if override != "" {
		return override, nil
	}
	p := filepath.Join(dataDir, "token")
	if raw, err := os.ReadFile(p); err == nil {
		token := strings.TrimSpace(string(raw))
		if len(token) >= 16 {
			return token, nil
		}
	}
	token := randomHex(32)
	if err := os.WriteFile(p, []byte(token+"\n"), 0o600); err != nil {
		return "", err
	}
	return token, nil
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":         "arutosiod",
		"version":      version,
		"mode":         "local",
		"capabilities": []string{"fs.list", "fs.read", "fs.write", "fs.upload", "fs.download", "fs.mkdir", "fs.rename", "fs.delete", "profile", "system", "update", "term", "static"},
		"auth":         []string{"cookie", "bearer"},
		"platform":     runtime.GOOS + "/" + runtime.GOARCH,
	})
}

func (s *server) handleTermPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	data, err := termFS.ReadFile("web/term.html")
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

func (s *server) handleSite(w http.ResponseWriter, r *http.Request) {
	p := path.Clean("/" + r.URL.Path)
	if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/ws/") {
		http.NotFound(w, r)
		return
	}
	if strings.Contains(p, "/.") || p == "/server" || strings.HasPrefix(p, "/server/") {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.FileServer(http.Dir(s.web)).ServeHTTP(w, r)
}

func displayAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	return net.JoinHostPort(host, port)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
