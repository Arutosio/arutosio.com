package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type processInfo struct {
	PID     int     `json:"pid"`
	User    string  `json:"user"`
	CPU     float64 `json:"cpu"`
	Memory  float64 `json:"memory"`
	RSS     uint64  `json:"rss"`
	Command string  `json:"command"`
}

type serviceInfo struct {
	Unit        string `json:"unit"`
	Load        string `json:"load"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	Description string `json:"description"`
	Protected   bool   `json:"protected"`
}

func (s *server) handleSystemInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	hostname, _ := os.Hostname()
	memTotal, memAvailable := readMemInfo()
	diskTotal, diskFree := diskInfo(s.root)
	profileBytes, profileFiles := dirStats(s.profileDir)
	trashBytes, trashFiles := dirStats(s.trashDir)
	load1, load5, load15 := readLoad()
	tmux, _ := exec.LookPath("tmux")
	terms := len(s.termInfos())

	var memUsed uint64
	if memAvailable <= memTotal {
		memUsed = memTotal - memAvailable
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hostname":     hostname,
		"platform":     runtime.GOOS + "/" + runtime.GOARCH,
		"version":      version,
		"cpus":         runtime.NumCPU(),
		"uptime":       readUptime(),
		"load":         []float64{load1, load5, load15},
		"memory":       map[string]uint64{"total": memTotal, "available": memAvailable, "used": memUsed},
		"disk":         map[string]any{"path": s.root, "total": diskTotal, "free": diskFree},
		"root":         s.root,
		"dataDir":      s.dataDir,
		"shell":        os.Getenv("SHELL"),
		"tmux":         tmux != "",
		"profile":      map[string]any{"bytes": profileBytes, "files": profileFiles},
		"trash":        map[string]any{"bytes": trashBytes, "files": trashFiles},
		"termSessions": terms,
	})
}

func readMemInfo() (total, available uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = value * 1024
		case "MemAvailable:":
			available = value * 1024
		}
	}
	return total, available
}

func diskInfo(path string) (total, free uint64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	return st.Blocks * uint64(st.Bsize), st.Bavail * uint64(st.Bsize)
}

func readUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	value, _ := strconv.ParseFloat(fields[0], 64)
	return int64(value)
}

func readLoad() (float64, float64, float64) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0
	}
	a, _ := strconv.ParseFloat(fields[0], 64)
	b, _ := strconv.ParseFloat(fields[1], 64)
	c, _ := strconv.ParseFloat(fields[2], 64)
	return a, b, c
}

func dirStats(path string) (bytes uint64, files int) {
	_ = filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			bytes += uint64(info.Size())
			files++
		}
		return nil
	})
	return bytes, files
}

func (s *server) handleSystemProcesses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-eo", "pid=,user=,pcpu=,pmem=,rss=,args=", "--sort=-pcpu").Output()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"processes": []processInfo{}, "error": err.Error()})
		return
	}
	processes := make([]processInfo, 0, 64)
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		mem, _ := strconv.ParseFloat(fields[3], 64)
		rss, _ := strconv.ParseUint(fields[4], 10, 64)
		command := strings.Join(fields[5:], " ")
		if command == "" {
			command = fields[4]
		}
		processes = append(processes, processInfo{
			PID: pid, User: fields[1], CPU: cpu, Memory: mem,
			RSS: rss * 1024, Command: command,
		})
		if len(processes) >= 60 {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"processes": processes})
}

func (s *server) handleSystemKill(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		PID int `json:"pid"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	if req.PID <= 1 || req.PID == os.Getpid() {
		fsError(w, http.StatusBadRequest, "protected process")
		return
	}
	if err := syscall.Kill(req.PID, syscall.SIGTERM); err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pid": req.PID})
}

func (s *server) handleSystemServices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	systemctl, err := exec.LookPath("systemctl")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "services": []serviceInfo{}})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, systemctl, "--user", "list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain").Output()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "services": []serviceInfo{}, "error": err.Error()})
		return
	}
	services := make([]serviceInfo, 0, 32)
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		fields := strings.Fields(strings.TrimSpace(sc.Text()))
		if len(fields) < 4 {
			continue
		}
		desc := strings.Join(fields[4:], " ")
		services = append(services, serviceInfo{
			Unit: fields[0], Load: fields[1], Active: fields[2], Sub: fields[3],
			Description: desc, Protected: fields[0] == "arutosiod.service",
		})
		if len(services) >= 100 {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": true, "services": services})
}

var serviceNameRe = regexp.MustCompile(`^[A-Za-z0-9_.@:-]+\.service$`)

func (s *server) handleSystemService(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Name   string `json:"name"`
		Action string `json:"action"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	if !serviceNameRe.MatchString(req.Name) || req.Name == "arutosiod.service" {
		fsError(w, http.StatusBadRequest, "protected or invalid unit")
		return
	}
	switch req.Action {
	case "start", "stop", "restart":
	default:
		fsError(w, http.StatusBadRequest, "invalid action")
		return
	}
	systemctl, err := exec.LookPath("systemctl")
	if err != nil {
		fsError(w, http.StatusBadRequest, "systemctl unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, systemctl, "--user", req.Action, req.Name).CombinedOutput()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error":  err.Error(),
			"output": string(out),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": string(out)})
}

func (s *server) handleSystemTrash(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	bytes, files := dirStats(s.trashDir)
	writeJSON(w, http.StatusOK, map[string]any{"path": s.trashDir, "bytes": bytes, "files": files})
}

type trashEntry struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Original  string    `json:"original"`
	DeletedAt time.Time `json:"deletedAt"`
	Bytes     uint64    `json:"bytes"`
	Files     int       `json:"files"`
}

type trashMeta struct {
	Original  string    `json:"original"`
	Name      string    `json:"name"`
	DeletedAt time.Time `json:"deletedAt"`
}

func (s *server) handleSystemTrashList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	entries, err := os.ReadDir(s.trashDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"entries": []trashEntry{}})
		return
	}
	out := make([]trashEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(s.trashDir, entry.Name())
		raw, err := os.ReadFile(filepath.Join(dir, "meta.json"))
		if err != nil {
			continue
		}
		var meta trashMeta
		if err := json.Unmarshal(raw, &meta); err != nil || meta.Name == "" || meta.Original == "" {
			continue
		}
		bytes, files := dirStats(dir)
		out = append(out, trashEntry{
			ID: entry.Name(), Name: meta.Name, Original: meta.Original,
			DeletedAt: meta.DeletedAt, Bytes: bytes, Files: files,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAt.After(out[j].DeletedAt) })
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

func (s *server) handleSystemTrashRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	if !safeID(req.ID) {
		fsError(w, http.StatusBadRequest, "invalid trash id")
		return
	}
	dir := filepath.Join(s.trashDir, req.ID)
	raw, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if err != nil {
		fsError(w, http.StatusNotFound, "trash entry not found")
		return
	}
	var meta trashMeta
	if err := json.Unmarshal(raw, &meta); err != nil || meta.Name == "" || meta.Original == "" {
		fsError(w, http.StatusBadRequest, "invalid trash metadata")
		return
	}
	if filepath.Base(meta.Name) != meta.Name {
		fsError(w, http.StatusBadRequest, "invalid trash name")
		return
	}
	full, _, err := s.resolvePathForCreate(meta.Original)
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := os.Lstat(full); err == nil {
		fsError(w, http.StatusConflict, "destination already exists")
		return
	}
	if err := os.Rename(filepath.Join(dir, meta.Name), full); err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = os.RemoveAll(dir)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": meta.Original})
}

func (s *server) handleSystemTrashEmpty(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := os.RemoveAll(s.trashDir); err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := os.MkdirAll(s.trashDir, 0o700); err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) handleSystemTerms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.termInfos(), "idleSeconds": int(s.termIdle.Seconds())})
}

func (s *server) handleSystemTermKill(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	if !termIDRe.MatchString(req.ID) {
		fsError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if !s.killTerm(req.ID) {
		fsError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
