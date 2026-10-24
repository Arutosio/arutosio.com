package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func cmdUninstall(args []string) int {
	fs := newSet("uninstall")
	data := addDataFlag(fs)
	purge := fs.Bool("purge", false, "also delete token, profile, trash and remaining data")
	yes := fs.Bool("yes", false, "do not ask for confirmation")
	_ = fs.Parse(args)

	cfg, _, err := loadConfig(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	if !*yes {
		if !askYesNo(fmt.Sprintf("Uninstall arutosiod from %s?", *data), false) {
			fmt.Println("cancelled")
			return 0
		}
	}

	// Stop the service and the background process.
	if systemdActive() {
		_, _ = exec.Command("systemctl", "--user", "disable", "--now", unitName).CombinedOutput()
	}
	if err := stopBackground(*data); err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
	}

	// Remove the unit only when it points at this installation.
	if raw, err := os.ReadFile(unitPath()); err == nil {
		ours := strings.Contains(string(raw), *data)
		if cfg.Binary != "" && strings.Contains(string(raw), cfg.Binary) {
			ours = true
		}
		if ours {
			_ = os.Remove(unitPath())
			_, _ = exec.Command("systemctl", "--user", "daemon-reload").CombinedOutput()
		} else {
			fmt.Fprintf(os.Stderr, "arutosiod: %s does not point to %s; leaving it in place\n", unitPath(), *data)
		}
	}

	code := 0
	if rec, ok := loadFirewallRecord(*data); ok {
		if err := closeFirewall(rec, *yes); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: close firewall: %v\n", err)
			fmt.Printf("close it manually: %s\n", firewallCloseManual(rec))
			code = 1
		} else {
			removeFirewallRecord(*data)
			fmt.Printf("firewall: closed %s in %s\n", rec.Rule, rec.Backend)
		}
	}

	// Remove the PATH symlink only when it points at this installation.
	link := filepath.Join(localBinDir(), "arutosiod")
	if target, err := os.Readlink(link); err == nil {
		resolved, _ := filepath.EvalSymlinks(link)
		installed := filepath.Join(*data, "bin", "arutosiod")
		if target == installed || resolved == installed {
			_ = os.Remove(link)
		}
	}

	for _, name := range []string{"arutosiod", "arutosiod.old", "arutosiod.rollback", "arutosiod.new"} {
		_ = os.Remove(filepath.Join(*data, "bin", name))
	}
	_ = os.Remove(filepath.Join(*data, "bin"))
	_ = os.RemoveAll(filepath.Join(*data, "current"))
	for _, path := range []string{configPath(*data), runtimePath(*data), logPath(*data), pidPath(*data), firewallPath(*data)} {
		_ = os.Remove(path)
	}

	if *purge {
		if !*yes {
			if !askYesNo("Delete the token, profile, trash and all remaining data?", false) {
				fmt.Printf("arutosiod removed; data kept in %s\n", *data)
				return code
			}
		}
		if err := os.RemoveAll(*data); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: purge: %v\n", err)
			return 1
		}
		fmt.Printf("arutosiod uninstalled; %s removed\n", *data)
		return code
	}

	fmt.Printf("arutosiod uninstalled; data kept in %s\n", *data)
	fmt.Println("Remove it with: arutosiod uninstall --purge")
	return code
}
