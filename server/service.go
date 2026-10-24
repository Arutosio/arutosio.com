package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func cmdStart(args []string) int {
	fs := newSet("start")
	data := addDataFlag(fs)
	noService := fs.Bool("no-service", false, "use a background process even if systemd is available")
	_ = fs.Parse(args)

	if err := os.MkdirAll(*data, 0o700); err == nil {
		_ = os.Chmod(*data, 0o700)
	}
	cfg, _, err := loadConfig(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	if _, err := os.Stat(filepath.Join(cfg.Web, "index.html")); err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: web root %s is not installed; run the installer first\n", cfg.Web)
		return 1
	}
	port := listenPort(cfg.Listen)
	if _, err := probeHealth(port); err == nil {
		fmt.Printf("arutosiod is already running on %s\n", cfg.Listen)
		return 0
	}
	if portOpen(port) {
		fmt.Fprintf(os.Stderr, "arutosiod: port %d is already in use by another process\n", port)
		return 1
	}

	service := cfg.Service
	if *noService {
		service = "background"
	} else if service == "" || service == "auto" {
		if userSystemdAvailable() {
			service = "systemd"
		} else {
			service = "background"
		}
	}
	if service == "systemd" && !userSystemdAvailable() {
		fmt.Fprintln(os.Stderr, "arutosiod: user systemd is not available; using a background process")
		service = "background"
	}
	cfg.Service = service
	cfg.Binary = resolveBinary(cfg)
	if cfg.Binary == "" {
		fmt.Fprintln(os.Stderr, "arutosiod: cannot find the binary")
		return 1
	}

	if service == "systemd" {
		if err := writeUnit(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: write unit: %v\n", err)
			service = "background"
			cfg.Service = "background"
		} else {
			_, _ = exec.Command("systemctl", "--user", "daemon-reload").CombinedOutput()
			if out, err := exec.Command("systemctl", "--user", "enable", "--now", unitName).CombinedOutput(); err != nil {
				fmt.Fprintf(os.Stderr, "arutosiod: systemd start failed: %v\n%s\n", err, out)
				_, _ = exec.Command("systemctl", "--user", "stop", unitName).CombinedOutput()
				_, _ = exec.Command("systemctl", "--user", "reset-failed", unitName).CombinedOutput()
				fmt.Fprintln(os.Stderr, "arutosiod: falling back to a background process")
				service = "background"
				cfg.Service = "background"
			}
		}
	}

	if service == "background" {
		if _, err := os.Stat(unitPath()); err == nil {
			if _, err := exec.LookPath("systemctl"); err == nil {
				_, _ = exec.Command("systemctl", "--user", "disable", unitName).CombinedOutput()
			}
		}
		if err := startBackground(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: start: %v\n", err)
			return 1
		}
	}

	if !waitHealthy(port, 12*time.Second) {
		fmt.Fprintf(os.Stderr, "arutosiod: did not become healthy on %s\n", cfg.Listen)
		if service == "systemd" {
			fmt.Fprintln(os.Stderr, "Logs: journalctl --user -u arutosiod -n 50")
		} else {
			fmt.Fprintf(os.Stderr, "Logs: %s\n", logPath(*data))
		}
		return 1
	}
	if err := saveConfig(*data, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: warning: save config: %v\n", err)
	}
	fmt.Printf("arutosiod started on %s (%s)\n", cfg.Listen, service)
	return 0
}

func cmdStop(args []string) int {
	fs := newSet("stop")
	data := addDataFlag(fs)
	_ = fs.Parse(args)

	cfg, _, err := loadConfig(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	stopped := false
	if systemdActive() {
		if out, err := exec.Command("systemctl", "--user", "stop", unitName).CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: systemctl stop: %v\n%s\n", err, out)
		} else {
			stopped = true
		}
	}
	if err := stopBackground(*data); err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	port := listenPort(cfg.Listen)
	for i := 0; i < 20 && portOpen(port); i++ {
		time.Sleep(250 * time.Millisecond)
	}
	if portOpen(port) {
		if _, err := probeHealth(port); err == nil {
			fmt.Fprintf(os.Stderr, "arutosiod: %s is still answering; stop it manually\n", cfg.Listen)
			return 1
		}
	}
	if stopped || !portOpen(port) {
		fmt.Println("arutosiod stopped")
		return 0
	}
	fmt.Println("arutosiod is not running")
	return 0
}

func cmdRestart(args []string) int {
	fs := newSet("restart")
	data := addDataFlag(fs)
	noService := fs.Bool("no-service", false, "use a background process even if systemd is available")
	_ = fs.Parse(args)

	if code := cmdStop([]string{"--data", *data}); code != 0 {
		return code
	}
	startArgs := []string{"--data", *data}
	if *noService {
		startArgs = append(startArgs, "--no-service")
	}
	return cmdStart(startArgs)
}
