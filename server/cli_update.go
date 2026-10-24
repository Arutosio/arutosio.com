package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func apiCall(data, method, path string, timeout time.Duration) (int, []byte, error) {
	cfg, _, err := loadConfig(data)
	if err != nil {
		return 0, nil, err
	}
	token, err := readToken(data)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", listenPort(cfg.Listen), path), nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, body, nil
}

func fetchCLIUpdate(data string) (updateStatus, error) {
	code, body, err := apiCall(data, http.MethodGet, "/api/update?force=1", 25*time.Second)
	if err != nil {
		return updateStatus{}, fmt.Errorf("is arutosiod running? %w", err)
	}
	if code != http.StatusOK {
		return updateStatus{}, fmt.Errorf("update check: %s: %s", http.StatusText(code), string(body))
	}
	var st updateStatus
	if err := json.Unmarshal(body, &st); err != nil {
		return updateStatus{}, err
	}
	return st, nil
}

func printUpdateStatus(st updateStatus, asJSON bool) {
	if asJSON {
		raw, _ := json.MarshalIndent(st, "", "  ")
		fmt.Println(string(raw))
		return
	}
	fmt.Printf("Current:  %s\n", st.Current)
	if st.Latest != "" {
		fmt.Printf("Latest:   %s\n", st.Latest)
	}
	switch {
	case st.Error != "":
		fmt.Printf("Status:   check failed: %s\n", st.Error)
	case st.Available && st.CanApply:
		fmt.Printf("Status:   update available (signed, ready to install)\n")
	case st.Available:
		fmt.Printf("Status:   update available, automatic install unavailable: %s\n", st.Reason)
	case st.Reason != "" && st.Reason != "up to date":
		fmt.Printf("Status:   %s\n", st.Reason)
	default:
		fmt.Printf("Status:   up to date\n")
	}
	if st.CanRollback {
		fmt.Printf("Rollback: %s available\n", st.RollbackVersion)
	}
}

func cmdUpdate(args []string) int {
	fs := newSet("update")
	data := addDataFlag(fs)
	check := fs.Bool("check", false, "only check for a new release")
	yes := fs.Bool("yes", false, "do not ask for confirmation")
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args)

	st, err := fetchCLIUpdate(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	if *check {
		printUpdateStatus(st, *asJSON)
		return 0
	}
	if !st.Available {
		printUpdateStatus(st, *asJSON)
		return 0
	}
	if !st.CanApply {
		printUpdateStatus(st, *asJSON)
		fmt.Fprintf(os.Stderr, "arutosiod: cannot install automatically: %s\n", st.Reason)
		return 1
	}
	if !*yes {
		if !isTerminal(os.Stdin) {
			fmt.Fprintln(os.Stderr, "arutosiod: non-interactive; use --yes to apply the update")
			return 1
		}
		if !askYesNo(fmt.Sprintf("Update arutosiod %s → %s? The daemon will restart.", st.Current, st.Latest), true) {
			fmt.Println("cancelled")
			return 0
		}
	}
	code, body, err := apiCall(*data, http.MethodPost, "/api/update/apply", 3*time.Minute)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: update: %v\n", err)
		return 1
	}
	if code != http.StatusOK {
		fmt.Fprintf(os.Stderr, "arutosiod: update failed: %s: %s\n", http.StatusText(code), string(body))
		return 1
	}
	if *asJSON {
		fmt.Println(string(body))
	} else {
		fmt.Printf("updating to %s…\n", st.Latest)
	}
	cfg, _, _ := loadConfig(*data)
	port := listenPort(cfg.Listen)
	for i := 0; i < 80; i++ {
		time.Sleep(500 * time.Millisecond)
		h, err := probeHealth(port)
		if err == nil && h.Version != "" && h.Version != st.Current {
			if !*asJSON {
				fmt.Printf("arutosiod %s is running\n", h.Version)
			}
			return 0
		}
	}
	fmt.Fprintln(os.Stderr, "arutosiod: the daemon did not come back; check \"arutosiod status\"")
	return 1
}

func cmdRollback(args []string) int {
	fs := newSet("rollback")
	data := addDataFlag(fs)
	yes := fs.Bool("yes", false, "do not ask for confirmation")
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args)

	st, err := fetchCLIUpdate(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	if !st.CanRollback {
		fmt.Fprintln(os.Stderr, "arutosiod: no rollback available")
		return 1
	}
	if !*yes {
		if !isTerminal(os.Stdin) {
			fmt.Fprintln(os.Stderr, "arutosiod: non-interactive; use --yes to roll back")
			return 1
		}
		if !askYesNo(fmt.Sprintf("Roll back to %s? The daemon will restart.", st.RollbackVersion), true) {
			fmt.Println("cancelled")
			return 0
		}
	}
	code, body, err := apiCall(*data, http.MethodPost, "/api/update/rollback", 3*time.Minute)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: rollback: %v\n", err)
		return 1
	}
	if code != http.StatusOK {
		fmt.Fprintf(os.Stderr, "arutosiod: rollback failed: %s: %s\n", http.StatusText(code), string(body))
		return 1
	}
	if *asJSON {
		fmt.Println(string(body))
	} else {
		fmt.Printf("rolling back to %s…\n", st.RollbackVersion)
	}
	cfg, _, _ := loadConfig(*data)
	port := listenPort(cfg.Listen)
	for i := 0; i < 80; i++ {
		time.Sleep(500 * time.Millisecond)
		h, err := probeHealth(port)
		if err == nil && h.Version != "" && h.Version != st.Current {
			if !*asJSON {
				fmt.Printf("arutosiod %s is running\n", h.Version)
			}
			return 0
		}
	}
	fmt.Fprintln(os.Stderr, "arutosiod: the daemon did not come back; check \"arutosiod status\"")
	return 1
}
