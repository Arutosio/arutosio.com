package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func runCommand(name string, args []string) int {
	switch name {
	case "serve":
		runServe(args)
		return 0
	case "status":
		return cmdStatus(args)
	case "start":
		return cmdStart(args)
	case "stop":
		return cmdStop(args)
	case "restart":
		return cmdRestart(args)
	case "logs":
		return cmdLogs(args)
	case "url":
		return cmdURL(args)
	case "token":
		return cmdToken(args)
	case "version":
		fmt.Println(version)
		return 0
	case "doctor":
		return cmdDoctor(args)
	case "lan":
		return cmdLan(args)
	case "firewall":
		return cmdFirewall(args)
	case "update":
		return cmdUpdate(args)
	case "rollback":
		return cmdRollback(args)
	case "uninstall":
		return cmdUninstall(args)
	case "completion":
		return cmdCompletion(args)
	case "help", "-h", "--help":
		printCLIHelp()
		return 0
	default:
		fmt.Fprintf(os.Stderr, "arutosiod: unknown command %q\n\n", name)
		printCLIHelp()
		return 2
	}
}

func printCLIHelp() {
	fmt.Print(`arutosiod — Arutosio OS daemon and machine manager

Usage:
  arutosiod status [--json] [--data DIR]
  arutosiod start [--no-service] [--data DIR]
  arutosiod stop [--data DIR]
  arutosiod restart [--data DIR]
  arutosiod logs [-n LINES] [-f] [--data DIR]
  arutosiod url [--lan] [--token] [--json] [--data DIR]
  arutosiod token [--data DIR]
  arutosiod version
  arutosiod doctor [--json] [--data DIR]
  arutosiod lan on|off|status [--yes] [--no-firewall] [--json]
  arutosiod firewall status|open|close [--port PORT] [--yes] [--json]
  arutosiod update [--check] [--yes] [--json]
  arutosiod rollback [--yes] [--json]
  arutosiod uninstall [--purge] [--yes] [--data DIR]
  arutosiod completion fish|bash|zsh
  arutosiod serve [flags]        explicit server mode (legacy flags still work)

Status, start, stop, logs, LAN and uninstall use ~/.arutosio by default;
pass --data DIR or set ARUTOSIO_HOME to point at another installation.

Run "arutosiod <command> --help" for command-specific help.
`)
}

func newSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet("arutosiod "+name, flag.ExitOnError)
	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: arutosiod %s [options]\n", name)
		fs.PrintDefaults()
	}
	return fs
}

func addDataFlag(fs *flag.FlagSet) *string {
	return fs.String("data", defaultDataDir(), "data directory")
}

func readToken(data string) (string, error) {
	raw, err := os.ReadFile(tokenPath(data))
	if err != nil {
		return "", fmt.Errorf("cannot read %s: %w", tokenPath(data), err)
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		return "", fmt.Errorf("%s is empty", tokenPath(data))
	}
	return token, nil
}

func fmtDuration(seconds int64) string {
	if seconds <= 0 {
		return "—"
	}
	d := seconds / 86400
	h := (seconds % 86400) / 3600
	m := (seconds % 3600) / 60
	switch {
	case d > 0:
		return fmt.Sprintf("%dd %dh", d, h)
	case h > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	default:
		return fmt.Sprintf("%dm", m)
	}
}

type statusReport struct {
	Version       string          `json:"version"`
	State         string          `json:"state"`
	Health        string          `json:"health"`
	Service       string          `json:"service"`
	ServiceActive bool            `json:"serviceActive"`
	PID           int             `json:"pid,omitempty"`
	UptimeSeconds int64           `json:"uptimeSeconds,omitempty"`
	Listen        string          `json:"listen"`
	Port          int             `json:"port"`
	LAN           bool            `json:"lan"`
	URLs          []string        `json:"urls"`
	PortState     string          `json:"portState"`
	Install       string          `json:"install"`
	Data          string          `json:"data"`
	Web           string          `json:"web"`
	Root          string          `json:"root"`
	Config        string          `json:"config"`
	ConfigFound   bool            `json:"configFound"`
	Token         string          `json:"token"`
	Logs          string          `json:"logs"`
	Firewall      *firewallRecord `json:"firewall,omitempty"`
	FirewallState *firewallState  `json:"firewallState,omitempty"`
}

func buildStatus(data string) (statusReport, int) {
	cfg, found, err := loadConfig(data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return statusReport{}, 3
	}
	rt, hasRuntime := loadRuntime(data)
	listen := cfg.Listen
	pid := 0
	var startedAt time.Time
	if hasRuntime && processAlive(rt.PID) {
		listen = rt.Listen
		pid = rt.PID
		startedAt = rt.StartedAt
	}
	port := listenPort(listen)

	health, healthErr := probeHealth(port)
	if healthErr == nil {
		pids := 0
		if hasRuntime && processAlive(rt.PID) {
			pids = rt.PID
		}
		if systemdActive() {
			if p := systemdMainPID(); p > 0 {
				pids = p
			}
		}
		if pids == 0 {
			pids = readPid(data)
		}
		if pids > 0 {
			pid = pids
		}
	} else if pid == 0 {
		if systemdActive() {
			pid = systemdMainPID()
		}
		if pid == 0 {
			pid = readPid(data)
		}
	}

	st := statusReport{
		Version:     version,
		PID:         pid,
		Listen:      listen,
		Port:        port,
		LAN:         isLANListen(listen),
		Data:        data,
		Web:         cfg.Web,
		Root:        cfg.Root,
		Config:      configPath(data),
		ConfigFound: found,
		Token:       tokenPath(data),
		Install:     cfg.Binary,
	}
	if health.Version != "" {
		st.Version = health.Version
	} else if cfg.Version != "" {
		st.Version = cfg.Version
	}
	if st.Install == "" {
		st.Install, _ = os.Executable()
	}
	if _, err := os.Stat(st.Install); err != nil {
		st.Install, _ = os.Executable()
	}
	if pid > 0 && processAlive(pid) && !startedAt.IsZero() {
		st.UptimeSeconds = int64(time.Since(startedAt).Seconds())
	}
	if st.UptimeSeconds < 0 {
		st.UptimeSeconds = 0
	}

	st.URLs = []string{fmt.Sprintf("http://localhost:%d/", port)}
	if st.LAN {
		for _, ip := range lanIPs() {
			st.URLs = append(st.URLs, fmt.Sprintf("http://%s:%d/", ip, port))
		}
	}

	unitExists := false
	if _, err := os.Stat(unitPath()); err == nil {
		unitExists = true
	}
	if systemdActive() {
		st.Service = "systemd"
		st.ServiceActive = true
	} else if pid > 0 && processAlive(pid) {
		st.Service = "background"
		st.ServiceActive = true
	} else if unitExists {
		st.Service = "systemd"
	} else {
		st.Service = "none"
	}
	if st.Service == "systemd" {
		st.Logs = "journalctl --user -u arutosiod -f"
	} else {
		st.Logs = logPath(data)
	}

	switch {
	case healthErr == nil:
		st.State = "running"
		st.Health = "ok"
		st.PortState = "arutosiod"
	case st.ServiceActive || (pid > 0 && processAlive(pid)):
		st.State = "unhealthy"
		st.Health = healthErr.Error()
		st.PortState = "occupied"
	case portOpen(port):
		st.State = "stopped"
		st.Health = "port used by another process"
		st.PortState = "occupied"
	default:
		st.State = "stopped"
		st.Health = "not running"
		st.PortState = "free"
	}

	if rec, ok := loadFirewallRecord(data); ok {
		st.Firewall = &rec
	}
	fs := detectFirewall(port)
	st.FirewallState = &fs

	code := 0
	switch st.State {
	case "stopped":
		code = 1
	case "unhealthy":
		code = 2
	}
	return st, code
}

func cmdStatus(args []string) int {
	fs := newSet("status")
	data := addDataFlag(fs)
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args)

	st, code := buildStatus(*data)
	if *asJSON {
		raw, _ := json.MarshalIndent(st, "", "  ")
		fmt.Println(string(raw))
		return code
	}
	printStatus(st)
	return code
}

func printStatus(st statusReport) {
	fmt.Printf("arutosiod %s\n\n", st.Version)
	service := "stopped"
	if st.ServiceActive {
		service = "running"
	}
	switch st.Service {
	case "systemd":
		service += " (systemd user unit)"
	case "background":
		service += " (background process)"
	default:
		service += " (no managed service)"
	}
	fmt.Printf("Service:   %s\n", service)
	fmt.Printf("Health:    %s\n", st.Health)
	fmt.Printf("Address:   %s (port %s)\n", st.Listen, st.PortState)
	if st.PID > 0 {
		fmt.Printf("PID:       %d\n", st.PID)
	}
	if st.UptimeSeconds > 0 {
		fmt.Printf("Uptime:    %s\n", fmtDuration(st.UptimeSeconds))
	}
	if st.LAN {
		fmt.Printf("Access:    LAN enabled\n")
		for _, u := range st.URLs {
			fmt.Printf("           %s\n", u)
		}
	} else {
		fmt.Printf("Access:    loopback only (run \"arutosiod lan on\" to expose it)\n")
	}
	fmt.Println()
	fmt.Printf("Install:   %s\n", st.Install)
	fmt.Printf("Data:      %s\n", st.Data)
	fmt.Printf("Web:       %s\n", st.Web)
	fmt.Printf("Root:      %s\n", st.Root)
	config := st.Config
	if !st.ConfigFound {
		config += " (missing)"
	}
	fmt.Printf("Config:    %s\n", config)
	fmt.Printf("Token:     %s\n", tokenDescription(st.Token))
	fmt.Printf("Logs:      %s\n", st.Logs)
	if st.FirewallState != nil {
		fmt.Printf("Firewall:  %s\n", firewallDescription(*st.FirewallState, st.Firewall, st.Port))
	}
}

func tokenDescription(path string) string {
	st, err := os.Stat(path)
	if err != nil {
		return path + " (missing)"
	}
	return fmt.Sprintf("%s (%04o)", path, st.Mode().Perm())
}

func firewallDescription(st firewallState, rec *firewallRecord, port int) string {
	switch st.Backend {
	case "none":
		return "no ufw/firewalld detected"
	case "ufw", "firewalld":
		if !st.Active && !st.NeedsRoot {
			return st.Backend + " — installed but not active"
		}
		if st.NeedsRoot {
			return st.Backend + " — status requires sudo"
		}
		if st.Allowed {
			if rec != nil && rec.Added {
				return fmt.Sprintf("%s — %d/tcp allowed (added by arutosiod)", st.Backend, port)
			}
			return fmt.Sprintf("%s — %d/tcp allowed", st.Backend, port)
		}
		return fmt.Sprintf("%s — %d/tcp BLOCKED (run \"arutosiod lan on\")", st.Backend, port)
	default:
		return fmt.Sprintf("%s — automatic detection not available", st.Backend)
	}
}

func cmdURL(args []string) int {
	fs := newSet("url")
	data := addDataFlag(fs)
	lan := fs.Bool("lan", false, "print LAN URLs")
	withToken := fs.Bool("token", false, "include the access token")
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args)

	cfg, _, err := loadConfig(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	port := listenPort(cfg.Listen)
	token := ""
	if *withToken {
		token, err = readToken(*data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
			return 1
		}
	}
	suffix := "/"
	if token != "" {
		suffix = "/?token=" + token
	}
	local := fmt.Sprintf("http://localhost:%d%s", port, suffix)
	var urls []string
	if *lan || isLANListen(cfg.Listen) {
		for _, ip := range lanIPs() {
			urls = append(urls, fmt.Sprintf("http://%s:%d%s", ip, port, suffix))
		}
	}
	if *asJSON {
		raw, _ := json.MarshalIndent(map[string]any{"local": local, "lan": urls}, "", "  ")
		fmt.Println(string(raw))
		return 0
	}
	if *lan {
		if !isLANListen(cfg.Listen) {
			fmt.Fprintln(os.Stderr, "LAN is disabled; run \"arutosiod lan on\" first")
		}
		if len(urls) == 0 {
			fmt.Fprintln(os.Stderr, "no LAN IPv4 address found")
			return 1
		}
		for _, u := range urls {
			fmt.Println(u)
		}
		return 0
	}
	fmt.Println(local)
	return 0
}

func cmdToken(args []string) int {
	fs := newSet("token")
	data := addDataFlag(fs)
	_ = fs.Parse(args)
	token, err := readToken(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	fmt.Println(token)
	return 0
}

func cmdLogs(args []string) int {
	fs := newSet("logs")
	data := addDataFlag(fs)
	lines := fs.Int("n", 50, "number of lines")
	follow := fs.Bool("f", false, "follow the log")
	_ = fs.Parse(args)

	var cmd *exec.Cmd
	if _, err := os.Stat(unitPath()); err == nil || systemdActive() {
		cmdArgs := []string{"--user", "-u", "arutosiod", "-n", fmt.Sprint(*lines)}
		if *follow {
			cmdArgs = append(cmdArgs, "-f")
		}
		cmd = exec.Command("journalctl", cmdArgs...)
	} else {
		if _, err := os.Stat(logPath(*data)); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: no log file at %s\n", logPath(*data))
			return 1
		}
		cmdArgs := []string{"-n", fmt.Sprint(*lines)}
		if *follow {
			cmdArgs = append(cmdArgs, "-f")
		}
		cmdArgs = append(cmdArgs, logPath(*data))
		cmd = exec.Command("tail", cmdArgs...)
	}
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: logs: %v\n", err)
		return 1
	}
	return 0
}

type doctorCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func cmdDoctor(args []string) int {
	fs := newSet("doctor")
	data := addDataFlag(fs)
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args)

	cfg, found, cfgErr := loadConfig(*data)
	st, _ := buildStatus(*data)
	checks := []doctorCheck{}
	add := func(status, name, detail string) {
		checks = append(checks, doctorCheck{Name: name, Status: status, Detail: detail})
	}

	if cfgErr != nil {
		add("fail", "config", cfgErr.Error())
	} else if !found {
		add("warn", "config", "config.json is missing; using defaults")
	} else {
		add("ok", "config", configPath(*data))
	}

	if st.Install != "" {
		if info, err := os.Stat(st.Install); err != nil || info.IsDir() {
			add("fail", "binary", st.Install+" is missing")
		} else if info.Mode().Perm()&0o111 == 0 {
			add("fail", "binary", st.Install+" is not executable")
		} else {
			add("ok", "binary", st.Install)
		}
	}
	if info, err := os.Stat(*data); err != nil || !info.IsDir() {
		add("fail", "data dir", *data+" is missing")
	} else if info.Mode().Perm()&0o077 != 0 {
		add("warn", "data dir", fmt.Sprintf("%s is %04o; expected 0700", *data, info.Mode().Perm()))
	} else {
		add("ok", "data dir", *data)
	}
	if info, err := os.Stat(tokenPath(*data)); err != nil {
		add("fail", "token", tokenPath(*data)+" is missing")
	} else if info.Mode().Perm()&0o077 != 0 {
		add("warn", "token", fmt.Sprintf("%s is %04o; expected 0600", tokenPath(*data), info.Mode().Perm()))
	} else {
		add("ok", "token", tokenPath(*data))
	}
	if _, err := os.Stat(filepath.Join(cfg.Web, "index.html")); err != nil {
		add("fail", "web root", cfg.Web+"/index.html is missing")
	} else {
		add("ok", "web root", cfg.Web)
	}

	switch st.State {
	case "running":
		add("ok", "service", fmt.Sprintf("%s, pid %d, %s", st.Service, st.PID, st.Listen))
	case "unhealthy":
		add("fail", "service", st.Health)
	default:
		add("warn", "service", "stopped")
	}
	switch st.PortState {
	case "arutosiod":
		add("ok", "port", fmt.Sprintf("%d/tcp served by arutosiod", st.Port))
	case "free":
		add("warn", "port", fmt.Sprintf("%d/tcp is free", st.Port))
	default:
		add("fail", "port", fmt.Sprintf("%d/tcp is used by another process", st.Port))
	}

	if st.LAN {
		if len(st.URLs) > 1 {
			add("ok", "LAN", strings.Join(st.URLs[1:], ", "))
		} else {
			add("warn", "LAN", "bound to 0.0.0.0 but no LAN IPv4 address was found")
		}
	} else {
		add("ok", "LAN", "loopback only")
	}
	if st.FirewallState != nil {
		status := "ok"
		if st.LAN {
			if st.FirewallState.NeedsRoot {
				status = "warn"
			} else if st.FirewallState.Active && !st.FirewallState.Allowed {
				status = "fail"
			}
		}
		add(status, "firewall", firewallDescription(*st.FirewallState, st.Firewall, st.Port))
	}

	if free, err := diskFree(*data); err == nil {
		if free < 50<<20 {
			add("warn", "disk", fmt.Sprintf("%d MB free", free>>20))
		} else {
			add("ok", "disk", fmt.Sprintf("%d MB free", free>>20))
		}
	}
	if host, err := os.Hostname(); err == nil {
		add("ok", "hostname", host)
	}

	if *asJSON {
		raw, _ := json.MarshalIndent(map[string]any{"checks": checks}, "", "  ")
		fmt.Println(string(raw))
	} else {
		for _, c := range checks {
			fmt.Printf("[%-4s] %-10s %s\n", c.Status, c.Name, c.Detail)
		}
	}
	for _, c := range checks {
		if c.Status == "fail" {
			return 1
		}
	}
	return 0
}

func diskFree(path string) (uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	return st.Bavail * uint64(st.Bsize), nil
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func askYesNo(prompt string, defaultYes bool) bool {
	if !isTerminal(os.Stdin) {
		return defaultYes
	}
	suffix := " [y/N] "
	if defaultYes {
		suffix = " [Y/n] "
	}
	fmt.Print(prompt + suffix)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return defaultYes
	}
	line = strings.ToLower(strings.TrimSpace(line))
	if line == "" {
		return defaultYes
	}
	return line == "y" || line == "yes" || line == "s" || line == "si" || line == "sì"
}
