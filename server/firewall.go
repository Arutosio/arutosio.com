package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type firewallRecord struct {
	Backend string `json:"backend"`
	Rule    string `json:"rule"`
	Port    int    `json:"port"`
	Added   bool   `json:"added"`
}

type firewallState struct {
	Backend   string `json:"backend"`
	Active    bool   `json:"active"`
	Allowed   bool   `json:"allowed"`
	Detail    string `json:"detail,omitempty"`
	NeedsRoot bool   `json:"needsRoot,omitempty"`
}

func firewallPath(data string) string { return filepath.Join(data, "firewall.json") }

func loadFirewallRecord(data string) (firewallRecord, bool) {
	raw, err := os.ReadFile(firewallPath(data))
	if err != nil {
		return firewallRecord{}, false
	}
	var rec firewallRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return firewallRecord{}, false
	}
	return rec, rec.Added
}

func saveFirewallRecord(data string, rec firewallRecord) error {
	raw, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicBytes(firewallPath(data), append(raw, '\n'), 0o600)
}

func removeFirewallRecord(data string) {
	_ = os.Remove(firewallPath(data))
}

func ufwAllows(out string, port int) bool {
	rule := fmt.Sprintf("%d/tcp", port)
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != rule {
			continue
		}
		if strings.Contains(strings.ToUpper(line), "ALLOW") {
			return true
		}
	}
	return false
}

func runCapture(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return string(out), err
}

func runCaptureSudoN(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sudo", append([]string{"-n", name}, args...)...).CombinedOutput()
	return string(out), err
}

func serviceActiveSystem(name string) bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", name).Run() == nil
}

// detectFirewall inspects what it can without prompting for a password. When
// the rule cannot be read, the state says NeedsRoot instead of guessing.
func detectFirewall(port int) firewallState {
	if _, err := exec.LookPath("ufw"); err == nil {
		out, err := runCapture(3*time.Second, "ufw", "status")
		if err != nil {
			out, err = runCaptureSudoN(3*time.Second, "ufw", "status")
		}
		if err == nil {
			st := firewallState{Backend: "ufw"}
			if strings.Contains(out, "Status: active") {
				st.Active = true
				st.Allowed = ufwAllows(out, port)
				if st.Allowed {
					st.Detail = "ufw allows the port"
				} else {
					st.Detail = "ufw blocks the port"
				}
			} else {
				st.Detail = "ufw is installed but not active"
				st.Allowed = true
			}
			return st
		}
		if serviceActiveSystem("ufw") {
			return firewallState{Backend: "ufw", Active: true, NeedsRoot: true, Detail: "ufw is active; run with sudo to inspect the rule"}
		}
		return firewallState{Backend: "ufw", Allowed: true, Detail: "ufw is installed but not active"}
	}

	if _, err := exec.LookPath("firewall-cmd"); err == nil {
		rule := fmt.Sprintf("%d/tcp", port)
		out, err := runCapture(3*time.Second, "firewall-cmd", "--state")
		if err == nil && strings.Contains(out, "running") {
			q, qerr := runCapture(3*time.Second, "firewall-cmd", "--query-port="+rule)
			if qerr == nil {
				return firewallState{Backend: "firewalld", Active: true, Allowed: strings.TrimSpace(q) == "yes", Detail: "firewalld is active"}
			}
			q, qerr = runCaptureSudoN(3*time.Second, "firewall-cmd", "--query-port="+rule)
			if qerr == nil {
				return firewallState{Backend: "firewalld", Active: true, Allowed: strings.TrimSpace(q) == "yes", Detail: "firewalld is active"}
			}
			return firewallState{Backend: "firewalld", Active: true, NeedsRoot: true, Detail: "firewalld is active; run with sudo to inspect the rule"}
		}
		if serviceActiveSystem("firewalld") {
			return firewallState{Backend: "firewalld", Active: true, NeedsRoot: true, Detail: "firewalld is active; run with sudo to inspect the rule"}
		}
	}

	for _, name := range []string{"nftables", "iptables"} {
		if serviceActiveSystem(name) {
			return firewallState{Backend: name, Active: true, NeedsRoot: true, Detail: name + " is active; open the port with your firewall tool"}
		}
	}
	return firewallState{Backend: "none", Allowed: true, Detail: "no ufw/firewalld detected"}
}

func sudoValidate(assumeYes bool) error {
	if os.Geteuid() == 0 {
		return nil
	}
	if _, err := exec.LookPath("sudo"); err != nil {
		return fmt.Errorf("sudo is not installed; open the firewall manually")
	}
	if assumeYes {
		if _, err := exec.Command("sudo", "-n", "-v").CombinedOutput(); err == nil {
			return nil
		}
	}
	cmd := exec.Command("sudo", "-v")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("sudo authentication failed; open the firewall manually")
	}
	return nil
}

func runPrivileged(name string, args ...string) (string, error) {
	if os.Geteuid() == 0 {
		return runCapture(30*time.Second, name, args...)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "sudo", append([]string{"-n", name}, args...)...).CombinedOutput()
	return string(out), err
}

// openFirewall opens the port when a supported firewall is active. It returns
// a record only when this call added the rule, so uninstall never removes a
// rule the user created themselves.
func openFirewall(port int, assumeYes bool) (firewallRecord, firewallState, error) {
	st := detectFirewall(port)
	if st.Backend == "none" {
		return firewallRecord{}, st, nil
	}
	if st.Backend != "ufw" && st.Backend != "firewalld" {
		return firewallRecord{}, st, fmt.Errorf("automatic firewall changes are not supported for %s; open port %d/tcp manually", st.Backend, port)
	}
	if !st.Active {
		return firewallRecord{}, st, nil
	}
	if st.Allowed {
		return firewallRecord{}, st, nil
	}
	if err := sudoValidate(assumeYes); err != nil {
		return firewallRecord{}, st, err
	}
	rule := fmt.Sprintf("%d/tcp", port)

	switch st.Backend {
	case "ufw":
		out, err := runPrivileged("ufw", "status")
		if err == nil && ufwAllows(out, port) {
			return firewallRecord{}, st, nil
		}
		if _, err := runPrivileged("ufw", "allow", rule); err != nil {
			return firewallRecord{}, st, fmt.Errorf("ufw allow: %v", err)
		}
		return firewallRecord{Backend: "ufw", Rule: rule, Port: port, Added: true}, st, nil
	case "firewalld":
		q, qerr := runPrivileged("firewall-cmd", "--query-port="+rule)
		if qerr == nil && strings.TrimSpace(q) == "yes" {
			return firewallRecord{}, st, nil
		}
		if _, err := runPrivileged("firewall-cmd", "--permanent", "--add-port="+rule); err != nil {
			return firewallRecord{}, st, fmt.Errorf("firewalld add port: %v", err)
		}
		if _, err := runPrivileged("firewall-cmd", "--reload"); err != nil {
			return firewallRecord{}, st, fmt.Errorf("firewalld reload: %v", err)
		}
		return firewallRecord{Backend: "firewalld", Rule: rule, Port: port, Added: true}, st, nil
	}
	return firewallRecord{}, st, nil
}

func closeFirewall(rec firewallRecord, assumeYes bool) error {
	if !rec.Added || rec.Rule == "" {
		return nil
	}
	if err := sudoValidate(assumeYes); err != nil {
		return err
	}
	switch rec.Backend {
	case "ufw":
		_, err := runPrivileged("ufw", "delete", "allow", rec.Rule)
		return err
	case "firewalld":
		if _, err := runPrivileged("firewall-cmd", "--permanent", "--remove-port="+rec.Rule); err != nil {
			return err
		}
		_, err := runPrivileged("firewall-cmd", "--reload")
		return err
	default:
		return fmt.Errorf("no automatic removal for firewall backend %q; close %s manually", rec.Backend, rec.Rule)
	}
}
