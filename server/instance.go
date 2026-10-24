package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultListen = "127.0.0.1:7777"
	unitName      = "arutosiod.service"
)

type instanceConfig struct {
	Version string `json:"version,omitempty"`
	Listen  string `json:"listen"`
	Binary  string `json:"binary,omitempty"`
	Root    string `json:"root"`
	Data    string `json:"data"`
	Web     string `json:"web"`
	Service string `json:"service,omitempty"` // systemd | background | auto
}

type runtimeInfo struct {
	PID       int       `json:"pid"`
	Version   string    `json:"version"`
	Listen    string    `json:"listen"`
	Web       string    `json:"web"`
	Root      string    `json:"root"`
	Data      string    `json:"data"`
	StartedAt time.Time `json:"startedAt"`
}

type healthInfo struct {
	Name     string `json:"name"`
	Version  string `json:"version"`
	Mode     string `json:"mode"`
	Platform string `json:"platform"`
}

func defaultDataDir() string {
	if v := os.Getenv("ARUTOSIO_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".arutosio"
	}
	return filepath.Join(home, ".arutosio")
}

func configPath(data string) string  { return filepath.Join(data, "config.json") }
func runtimePath(data string) string { return filepath.Join(data, "runtime.json") }
func pidPath(data string) string     { return filepath.Join(data, "arutosiod.pid") }
func logPath(data string) string     { return filepath.Join(data, "arutosiod.log") }
func tokenPath(data string) string   { return filepath.Join(data, "token") }

func localBinDir() string {
	if dir := os.Getenv("XDG_BIN_HOME"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "bin")
}

func loadConfig(data string) (instanceConfig, bool, error) {
	home, _ := os.UserHomeDir()
	cfg := instanceConfig{
		Listen: defaultListen,
		Data:   data,
		Web:    filepath.Join(data, "current", "web"),
		Root:   home,
		Binary: filepath.Join(data, "bin", "arutosiod"),
	}
	raw, err := os.ReadFile(configPath(data))
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, false, nil
		}
		return cfg, false, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, true, fmt.Errorf("%s: %w", configPath(data), err)
	}
	if cfg.Listen == "" {
		cfg.Listen = defaultListen
	}
	if cfg.Data == "" {
		cfg.Data = data
	}
	if cfg.Web == "" {
		cfg.Web = filepath.Join(data, "current", "web")
	}
	if cfg.Root == "" {
		cfg.Root = home
	}
	if cfg.Binary == "" {
		cfg.Binary = filepath.Join(data, "bin", "arutosiod")
	}
	return cfg, true, nil
}

func saveConfig(data string, cfg instanceConfig) error {
	cfg.Data = data
	cfg.Version = version
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicBytes(configPath(data), append(raw, '\n'), 0o600)
}

func loadRuntime(data string) (runtimeInfo, bool) {
	raw, err := os.ReadFile(runtimePath(data))
	if err != nil {
		return runtimeInfo{}, false
	}
	var rt runtimeInfo
	if json.Unmarshal(raw, &rt) != nil {
		return runtimeInfo{}, false
	}
	return rt, true
}

func saveRuntime(data string, rt runtimeInfo) error {
	raw, err := json.MarshalIndent(rt, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicBytes(runtimePath(data), append(raw, '\n'), 0o600)
}

func removeRuntime(data string) {
	_ = os.Remove(runtimePath(data))
}

func listenPort(listen string) int {
	_, p, err := net.SplitHostPort(listen)
	if err != nil {
		return 7777
	}
	n, err := strconv.Atoi(p)
	if err != nil {
		return 7777
	}
	return n
}

func isLANListen(listen string) bool {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return false
	}
	host = strings.Trim(host, "[]")
	return host == "" || host == "0.0.0.0" || host == "::"
}

func lanIPs() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := iface.Name
		if strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "br-") || strings.HasPrefix(name, "virbr") ||
			strings.HasPrefix(name, "tailscale") || strings.HasPrefix(name, "zt") ||
			strings.HasPrefix(name, "wg") {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			if v4 := ip.To4(); v4 != nil {
				out = append(out, v4.String())
			}
		}
	}
	sort.Strings(out)
	return out
}

func probeHealth(port int) (healthInfo, error) {
	client := &http.Client{Timeout: 900 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return healthInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return healthInfo{}, fmt.Errorf("health: %s", resp.Status)
	}
	var h healthInfo
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return healthInfo{}, err
	}
	if h.Name != "arutosiod" {
		return h, fmt.Errorf("port is serving %q, not arutosiod", h.Name)
	}
	return h, nil
}

func portOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 350*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

func pidIsArutosiod(pid int) bool {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return false
	}
	return strings.Contains(string(raw), "arutosiod")
}

func readPid(data string) int {
	raw, err := os.ReadFile(pidPath(data))
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	return n
}

func writePid(data string, pid int) {
	_ = os.WriteFile(pidPath(data), []byte(strconv.Itoa(pid)+"\n"), 0o600)
}

func removePid(data string) {
	_ = os.Remove(pidPath(data))
}

func userSystemdAvailable() bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "systemctl", "--user", "show-environment").Run() == nil
}

func systemdActive() bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "systemctl", "--user", "is-active", "--quiet", unitName).Run() == nil
}

func systemdMainPID() int {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "systemctl", "--user", "show", "-p", "MainPID", "--value", unitName).Output()
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return n
}

func unitPath() string {
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "systemd", "user", unitName)
}

func systemdQuote(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}

func writeUnit(cfg instanceConfig) error {
	if err := os.MkdirAll(filepath.Dir(unitPath()), 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf(`[Unit]
Description=Arutosio OS daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s -listen %s -web %s -root %s -data %s
Restart=on-failure
RestartSec=2
WorkingDirectory=%%h

[Install]
WantedBy=default.target
`, systemdQuote(cfg.Binary), systemdQuote(cfg.Listen), systemdQuote(cfg.Web), systemdQuote(cfg.Root), systemdQuote(cfg.Data))
	return os.WriteFile(unitPath(), []byte(body), 0o644)
}

func resolveBinary(cfg instanceConfig) string {
	if cfg.Binary != "" {
		if st, err := os.Stat(cfg.Binary); err == nil && !st.IsDir() {
			return cfg.Binary
		}
	}
	if exe, err := os.Executable(); err == nil {
		return exe
	}
	return ""
}

func startBackground(cfg instanceConfig) error {
	bin := resolveBinary(cfg)
	if bin == "" {
		return fmt.Errorf("cannot find the arutosiod binary")
	}
	logFile, err := os.OpenFile(logPath(cfg.Data), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	cmd := exec.Command(bin,
		"-listen", cfg.Listen,
		"-web", cfg.Web,
		"-root", cfg.Root,
		"-data", cfg.Data)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	_ = logFile.Close()
	writePid(cfg.Data, cmd.Process.Pid)
	return cmd.Process.Release()
}

func stopBackground(data string) error {
	pid := readPid(data)
	if pid > 0 && processAlive(pid) {
		if !pidIsArutosiod(pid) {
			return fmt.Errorf("pid %d is not arutosiod; refusing to kill it", pid)
		}
		_ = syscall.Kill(pid, syscall.SIGTERM)
		for i := 0; i < 20 && processAlive(pid); i++ {
			time.Sleep(250 * time.Millisecond)
		}
		if processAlive(pid) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}
	removePid(data)
	removeRuntime(data)
	return nil
}

func waitHealthy(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := probeHealth(port); err == nil {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	return false
}
