package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListenHelpers(t *testing.T) {
	cases := []struct {
		listen string
		port   int
		lan    bool
	}{
		{"127.0.0.1:7777", 7777, false},
		{"localhost:8080", 8080, false},
		{"0.0.0.0:7777", 7777, true},
		{":7777", 7777, true},
		{"[::]:7777", 7777, true},
		{"[::1]:7777", 7777, false},
	}
	for _, c := range cases {
		if got := listenPort(c.listen); got != c.port {
			t.Errorf("listenPort(%q) = %d, want %d", c.listen, got, c.port)
		}
		if got := isLANListen(c.listen); got != c.lan {
			t.Errorf("isLANListen(%q) = %v, want %v", c.listen, got, c.lan)
		}
	}
}

func TestConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	cfg, found, err := loadConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatal("config should not exist yet")
	}
	if cfg.Listen != defaultListen || cfg.Data != dir {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}

	cfg.Listen = "0.0.0.0:7788"
	cfg.Service = "background"
	cfg.Binary = "/tmp/arutosiod"
	cfg.Root = "/home/u"
	cfg.Web = "/tmp/web"
	if err := saveConfig(dir, cfg); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(configPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %04o", info.Mode().Perm())
	}
	got, found, err := loadConfig(dir)
	if err != nil || !found {
		t.Fatalf("load: %v, found=%v", err, found)
	}
	if got.Listen != cfg.Listen || got.Service != "background" || got.Binary != cfg.Binary {
		t.Fatalf("round trip: %+v", got)
	}
}

func TestFirewallRecordRoundTrip(t *testing.T) {
	dir := t.TempDir()
	rec := firewallRecord{Backend: "ufw", Rule: "7777/tcp", Port: 7777, Added: true}
	if err := saveFirewallRecord(dir, rec); err != nil {
		t.Fatal(err)
	}
	got, ok := loadFirewallRecord(dir)
	if !ok || got != rec {
		t.Fatalf("record = %+v, %v", got, ok)
	}
	removeFirewallRecord(dir)
	if _, ok := loadFirewallRecord(dir); ok {
		t.Fatal("record still present")
	}
}

func TestUFWAllows(t *testing.T) {
	out := `Status: active

To                         Action      From
--                         ------      ----
7777/tcp                   ALLOW       Anywhere
7777/tcp (v6)              ALLOW       Anywhere (v6)
22/tcp                     LIMIT       Anywhere
`
	if !ufwAllows(out, 7777) {
		t.Fatal("7777 should be allowed")
	}
	if ufwAllows(out, 22) {
		t.Fatal("LIMIT is not ALLOW")
	}
	if ufwAllows(out, 8080) {
		t.Fatal("8080 is not listed")
	}
}

func TestReadToken(t *testing.T) {
	dir := t.TempDir()
	if _, err := readToken(dir); err == nil {
		t.Fatal("missing token should fail")
	}
	if err := os.WriteFile(tokenPath(dir), []byte("abc123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	token, err := readToken(dir)
	if err != nil || token != "abc123" {
		t.Fatalf("token = %q, %v", token, err)
	}
}

func TestFirewallDescription(t *testing.T) {
	rec := &firewallRecord{Backend: "ufw", Rule: "7777/tcp", Added: true}
	blocked := firewallDescription(firewallState{Backend: "ufw", Active: true, Allowed: false}, rec, 7777)
	if !strings.Contains(blocked, "BLOCKED") {
		t.Fatalf("blocked description = %q", blocked)
	}
	allowed := firewallDescription(firewallState{Backend: "ufw", Active: true, Allowed: true}, rec, 7777)
	if !strings.Contains(allowed, "added by arutosiod") {
		t.Fatalf("allowed description = %q", allowed)
	}
	inactive := firewallDescription(firewallState{Backend: "ufw", Active: false}, nil, 7777)
	if !strings.Contains(inactive, "not active") {
		t.Fatalf("inactive description = %q", inactive)
	}
}

func TestStatusJSONFields(t *testing.T) {
	st := statusReport{Version: "1.0.0", State: "running", Port: 7777, Listen: "127.0.0.1:7777"}
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"version", "state", "port", "listen"} {
		if _, ok := out[key]; !ok {
			t.Errorf("missing %q in %s", key, raw)
		}
	}
}

func TestDataDirDefault(t *testing.T) {
	t.Setenv("ARUTOSIO_HOME", filepath.Join(t.TempDir(), "custom"))
	if got := defaultDataDir(); got != os.Getenv("ARUTOSIO_HOME") {
		t.Fatalf("defaultDataDir = %q", got)
	}
}
