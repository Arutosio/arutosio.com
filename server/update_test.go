package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.4.0", "0.4.0", 0},
		{"v0.4.0", "0.4.0", 0},
		{"0.4.0", "0.5.0", -1},
		{"0.10.0", "0.9.9", 1},
		{"1.0.0-rc1", "1.0.0", -1},
		{"1.0.0", "1.0.0-rc1", 1},
		{"1.0", "1.0.0", 0},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func makeBundle(t *testing.T, binary []byte, web map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	write := func(name string, data []byte) {
		if err := tw.WriteHeader(&tar.Header{
			Name: name, Mode: 0o644, Size: int64(len(data)), Typeflag: tar.TypeReg,
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	write("arutosiod", binary)
	for name, body := range web {
		write(name, []byte(body))
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestFetchUpdateAndStage(t *testing.T) {
	binary := append([]byte("\x7fELF"), []byte("fake daemon body")...)
	bundle := makeBundle(t, binary, map[string]string{
		"web/index.html":        "<html>arutosio</html>",
		"web/JavaScript/app.js": "// app",
	})
	sum := sha256.Sum256(bundle)

	var baseURL string
	mux := http.NewServeMux()
	mux.HandleFunc("/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(releasePayload{
			Tag:  "v9.9.9",
			Body: "release notes",
			URL:  "https://example.test/release",
			Assets: []releaseAsset{{
				Name:   updateAssetName(),
				URL:    baseURL + "/asset/arutosio",
				Digest: "sha256:" + hex.EncodeToString(sum[:]),
			}},
		})
	})
	mux.HandleFunc("/asset/arutosio", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bundle)
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()
	baseURL = ts.URL

	s := &server{updateState: updateState{updateURL: ts.URL + "/latest", updateClient: ts.Client()}}
	res := s.fetchUpdate(context.Background())
	if res.Status.Error != "" {
		t.Fatalf("fetch error: %s", res.Status.Error)
	}
	if !res.Status.Available || res.Status.Latest != "9.9.9" {
		t.Fatalf("unexpected status: %+v", res.Status)
	}
	if res.Asset.Name != updateAssetName() {
		t.Fatalf("asset = %q", res.Asset.Name)
	}

	staged, err := s.stageUpdate(context.Background(), res.Asset, t.TempDir(), res.Checksum)
	if err != nil {
		t.Fatalf("stage: %v", err)
	}
	defer os.RemoveAll(staged.WorkDir)

	data, err := os.ReadFile(staged.Binary)
	if err != nil || string(data) != string(binary) {
		t.Fatalf("staged binary = %q, %v", data, err)
	}
	st, err := os.Stat(staged.Binary)
	if err != nil {
		t.Fatalf("stat staged binary: %v", err)
	}
	if st.Mode().Perm() != 0o755 {
		t.Fatalf("staged mode = %v", st.Mode())
	}
	if staged.Web == "" {
		t.Fatal("web bundle was not extracted")
	}
	if raw, err := os.ReadFile(filepath.Join(staged.Web, "index.html")); err != nil || string(raw) != "<html>arutosio</html>" {
		t.Fatalf("web/index.html = %q, %v", raw, err)
	}

	zero := hex.EncodeToString(make([]byte, sha256.Size))
	if _, err := s.stageUpdate(context.Background(), res.Asset, t.TempDir(), zero); err == nil {
		t.Fatal("stage accepted a bad checksum")
	}
}

func TestSignedRelease(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	binary := append([]byte("\x7fELF"), []byte("signed daemon")...)
	bundle := makeBundle(t, binary, map[string]string{"web/index.html": "<html>signed</html>"})
	sum := sha256.Sum256(bundle)
	checksums := []byte(hex.EncodeToString(sum[:]) + "  " + updateAssetName() + "\n")
	sig := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, checksums)) + "\n")

	var baseURL string
	mux := http.NewServeMux()
	mux.HandleFunc("/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(releasePayload{
			Tag: "v9.9.9",
			Assets: []releaseAsset{
				{Name: updateAssetName(), URL: baseURL + "/bundle", Digest: "sha256:" + hex.EncodeToString(sum[:])},
				{Name: "checksums.txt", URL: baseURL + "/checksums"},
				{Name: "checksums.txt.sig", URL: baseURL + "/sig"},
			},
		})
	})
	mux.HandleFunc("/bundle", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(bundle) })
	mux.HandleFunc("/checksums", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(checksums) })
	mux.HandleFunc("/sig", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(sig) })
	ts := httptest.NewServer(mux)
	defer ts.Close()
	baseURL = ts.URL

	s := &server{updateState: updateState{
		updateURL:    ts.URL + "/latest",
		updatePubkey: hex.EncodeToString(pub),
		updateClient: ts.Client(),
	}}
	res := s.fetchUpdate(context.Background())
	if res.Status.Error != "" || !res.Status.Available {
		t.Fatalf("fetch: %+v", res.Status)
	}
	if res.Checksum != hex.EncodeToString(sum[:]) {
		t.Fatalf("checksum = %q", res.Checksum)
	}
	if _, err := s.stageUpdate(context.Background(), res.Asset, t.TempDir(), res.Checksum); err != nil {
		t.Fatalf("stage signed bundle: %v", err)
	}

	sig = []byte(base64.StdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize)) + "\n")
	res = s.fetchUpdate(context.Background())
	if res.Checksum != "" || res.Status.CanApply || res.Status.Reason != "release signature is invalid" {
		t.Fatalf("tampered signature accepted: %+v", res.Status)
	}
}

func TestExtractBundleRejectsTraversal(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	_ = tw.WriteHeader(&tar.Header{Name: "../escape", Mode: 0o644, Size: 1, Typeflag: tar.TypeReg})
	_, _ = tw.Write([]byte("x"))
	_ = tw.Close()
	_ = gz.Close()

	if _, err := extractBundle(writeTemp(t, buf.Bytes()), t.TempDir()); err == nil {
		t.Fatal("extractBundle accepted a path traversal entry")
	}
}

func writeTemp(t *testing.T, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "bundle.tar.gz")
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestBackupFile(t *testing.T) {
	src := filepath.Join(t.TempDir(), "arutosiod")
	if err := os.WriteFile(src, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	dst := src + ".old"
	if err := backupFile(src, dst); err != nil {
		t.Fatalf("backup: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != "binary" {
		t.Fatalf("backup = %q, %v", data, err)
	}
}

func TestRollbackInfo(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "arutosiod")
	if err := os.WriteFile(exe, []byte("current"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe+".old", []byte("#!/bin/sh\necho 0.3.0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	data := t.TempDir()
	web := filepath.Join(data, "current", "web")
	if err := os.MkdirAll(web, 0o755); err != nil {
		t.Fatal(err)
	}
	managed := &server{dataDir: data, web: web}
	if _, ok := managed.rollbackInfoFor(exe); ok {
		t.Fatal("rollback accepted without a web backup")
	}
	if err := os.MkdirAll(web+".old", 0o755); err != nil {
		t.Fatal(err)
	}
	if v, ok := managed.rollbackInfoFor(exe); !ok || v != "0.3.0" {
		t.Fatalf("rollback info = %q, %v", v, ok)
	}

	unmanaged := &server{dataDir: data, web: filepath.Join(data, "repo")}
	if v, ok := unmanaged.rollbackInfoFor(exe); !ok || v != "0.3.0" {
		t.Fatalf("unmanaged rollback info = %q, %v", v, ok)
	}
}

func TestReleaseDownloadBase(t *testing.T) {
	got := releaseDownloadBase("0.5.3")
	want := "https://github.com/Arutosio/arutosio.com/releases/download/v0.5.3/"
	if got != want {
		t.Fatalf("releaseDownloadBase = %q, want %q", got, want)
	}
}

func TestFetchUpdateNoRelease(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer ts.Close()
	s := &server{updateState: updateState{updateURL: ts.URL, updateClient: ts.Client()}}
	res := s.fetchUpdate(context.Background())
	if res.Status.Available || res.Status.Error != "" || res.Status.Reason != "no releases published" {
		t.Fatalf("unexpected status: %+v", res.Status)
	}
}

func TestSessionsPersist(t *testing.T) {
	file := filepath.Join(t.TempDir(), "sessions.json")

	s1 := &server{sessions: make(map[string]session), sessionFile: file}
	id, ses := s1.newSession()

	s2 := &server{sessions: make(map[string]session), sessionFile: file}
	s2.loadSessions()
	got, ok := s2.getSession(id)
	if !ok || got.csrf != ses.csrf {
		t.Fatal("session did not survive a reload")
	}

	s2.deleteSession(id)
	s3 := &server{sessions: make(map[string]session), sessionFile: file}
	s3.loadSessions()
	if _, ok := s3.getSession(id); ok {
		t.Fatal("logged-out session came back after a reload")
	}
}
