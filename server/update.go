package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	updateTTL         = time.Hour
	updateMaxBytes    = 64 << 20
	updateMaxUnpacked = 256 << 20
	// GitHub's "latest release" endpoint for this repository. Blank disables
	// the check (-update-url "").
	defaultUpdateURL = "https://api.github.com/repos/Arutosio/arutosio.com/releases/latest"
)

type releaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Digest string `json:"digest"`
}

type releasePayload struct {
	Tag    string         `json:"tag_name"`
	Body   string         `json:"body"`
	URL    string         `json:"html_url"`
	Assets []releaseAsset `json:"assets"`
}

type updateStatus struct {
	Current         string    `json:"current"`
	Latest          string    `json:"latest,omitempty"`
	Available       bool      `json:"available"`
	CanApply        bool      `json:"canApply"`
	CanRollback     bool      `json:"canRollback"`
	RollbackVersion string    `json:"rollbackVersion,omitempty"`
	Reason          string    `json:"reason,omitempty"`
	Error           string    `json:"error,omitempty"`
	Notes           string    `json:"notes,omitempty"`
	URL             string    `json:"url,omitempty"`
	CheckedAt       time.Time `json:"checkedAt"`
}

type updateResult struct {
	Status updateStatus
	Asset  releaseAsset
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	return strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
}

func splitVersion(v string) ([]int, string) {
	v = normalizeVersion(v)
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		pre = v[i+1:]
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			n = 0
		}
		nums = append(nums, n)
	}
	return nums, pre
}

// compareVersions returns -1, 0 or 1 for dotted numeric versions. A plain
// release sorts after its own pre-release (1.0.0 > 1.0.0-rc1).
func compareVersions(a, b string) int {
	an, ap := splitVersion(a)
	bn, bp := splitVersion(b)
	for i := 0; i < len(an) || i < len(bn); i++ {
		var x, y int
		if i < len(an) {
			x = an[i]
		}
		if i < len(bn) {
			y = bn[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	switch {
	case ap == bp:
		return 0
	case ap == "":
		return 1
	case bp == "":
		return -1
	case ap < bp:
		return -1
	default:
		return 1
	}
}

func updateAssetName() string {
	arch := runtime.GOARCH
	if arch == "arm" {
		arch = "armv7"
	}
	return "arutosio-linux-" + arch + ".tar.gz"
}

func updateExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return exe, nil
}

func updateDirWritable(dir string) bool {
	return syscall.Access(dir, 0x2) == nil // W_OK
}

func safeReleaseURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return u.String()
}

func (s *server) getUpdate(ctx context.Context, force bool) updateResult {
	s.updateMu.Lock()
	if !force && s.updateCache != nil && time.Since(s.updateAt) < updateTTL {
		cached := *s.updateCache
		s.updateMu.Unlock()
		return cached
	}
	s.updateMu.Unlock()

	res := s.fetchUpdate(ctx)

	s.updateMu.Lock()
	s.updateCache = &res
	s.updateAt = time.Now()
	s.updateMu.Unlock()
	return res
}

func (s *server) fetchUpdate(ctx context.Context) updateResult {
	res := updateResult{Status: updateStatus{Current: version, CheckedAt: time.Now().UTC()}}
	if v, ok := s.rollbackInfo(); ok {
		res.Status.CanRollback = true
		res.Status.RollbackVersion = v
	}
	if s.updateURL == "" {
		res.Status.Reason = "update checks are disabled"
		return res
	}
	if s.updateClient == nil {
		s.updateClient = &http.Client{}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.updateURL, nil)
	if err != nil {
		res.Status.Error = err.Error()
		return res
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "arutosiod/"+version)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := s.updateClient.Do(req)
	if err != nil {
		res.Status.Error = "release check: " + err.Error()
		return res
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		res.Status.Reason = "no releases published"
		return res
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		res.Status.Error = fmt.Sprintf("release check: %s %s", resp.Status, strings.TrimSpace(string(body)))
		return res
	}

	var rel releasePayload
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rel); err != nil {
		res.Status.Error = "release check: " + err.Error()
		return res
	}
	res.Status.Latest = normalizeVersion(rel.Tag)
	res.Status.Notes = strings.TrimSpace(rel.Body)
	res.Status.URL = safeReleaseURL(rel.URL)
	if res.Status.Latest == "" {
		res.Status.Error = "release has no tag"
		return res
	}
	res.Status.Available = compareVersions(res.Status.Latest, version) > 0
	if !res.Status.Available {
		res.Status.Reason = "up to date"
		return res
	}

	for _, a := range rel.Assets {
		if a.Name == updateAssetName() {
			a.URL = safeReleaseURL(a.URL)
			res.Asset = a
			break
		}
	}

	switch {
	case runtime.GOOS != "linux":
		res.Status.Reason = "self-update is only available on Linux"
	case res.Asset.Name == "":
		res.Status.Reason = "no build published for " + runtime.GOOS + "/" + runtime.GOARCH
	case res.Asset.URL == "":
		res.Status.Reason = "release build has no valid download url"
	case strings.TrimSpace(res.Asset.Digest) == "":
		res.Status.Reason = "release build has no sha256 checksum"
	default:
		exe, err := updateExecutable()
		if err != nil {
			res.Status.Reason = err.Error()
		} else if !updateDirWritable(filepath.Dir(exe)) {
			res.Status.Reason = "installation directory is not writable; run the installer"
		} else {
			res.Status.CanApply = true
		}
	}
	return res
}

type stagedUpdate struct {
	WorkDir string
	Binary  string
	Web     string
}

// backupFile keeps the running binary available without moving it away: a
// hard link when possible, a copy otherwise. The replacement rename is then
// atomic, so a crash can never leave the install without a binary.
func backupFile(src, dst string) error {
	if err := os.Link(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := out.Sync(); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(dst)
		return err
	}
	return nil
}

func binaryVersion(path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "-version").Output()
	if err != nil {
		return ""
	}
	v := strings.TrimSpace(string(out))
	if v == "" || len(v) > 64 || strings.ContainsAny(v, "\r\n") {
		return ""
	}
	return v
}

func (s *server) rollbackInfoFor(exe string) (string, bool) {
	backup := exe + ".old"
	if st, err := os.Stat(backup); err != nil || !st.Mode().IsRegular() {
		return "", false
	}
	if s.managedWebDir() {
		if st, err := os.Stat(s.web + ".old"); err != nil || !st.IsDir() {
			return "", false
		}
	}
	v := binaryVersion(backup)
	if v == "" {
		return "", false
	}
	return v, true
}

func (s *server) rollbackInfo() (string, bool) {
	exe, err := updateExecutable()
	if err != nil {
		return "", false
	}
	return s.rollbackInfoFor(exe)
}

// cleanupUpdateLeftovers removes the failed build kept after a rollback. It
// runs at startup, once the rolled-back build is actually serving.
func (s *server) cleanupUpdateLeftovers() {
	if exe, err := updateExecutable(); err == nil {
		_ = os.Remove(exe + ".rollback")
	}
	if s.managedWebDir() {
		_ = os.RemoveAll(s.web + ".rollback")
	}
}

func (s *server) managedWebDir() bool {
	if s.web == "" || s.dataDir == "" {
		return false
	}
	web, err := filepath.Abs(s.web)
	if err != nil {
		return false
	}
	return filepath.Clean(web) == filepath.Join(filepath.Clean(s.dataDir), "current", "web")
}

// stageUpdate downloads the release tarball, verifies its sha256 and unpacks
// it next to the binary (same filesystem, so the final renames are atomic).
func (s *server) stageUpdate(ctx context.Context, asset releaseAsset, dir string) (stagedUpdate, error) {
	if s.updateClient == nil {
		s.updateClient = &http.Client{}
	}
	work, err := os.MkdirTemp(dir, ".arutosiod-update-*")
	if err != nil {
		return stagedUpdate{}, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(work)
		}
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if err != nil {
		return stagedUpdate{}, err
	}
	req.Header.Set("User-Agent", "arutosiod/"+version)
	resp, err := s.updateClient.Do(req)
	if err != nil {
		return stagedUpdate{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return stagedUpdate{}, fmt.Errorf("download: %s", resp.Status)
	}

	archive := filepath.Join(work, "bundle.tar.gz")
	f, err := os.OpenFile(archive, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return stagedUpdate{}, err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, updateMaxBytes+1))
	if err != nil {
		_ = f.Close()
		return stagedUpdate{}, err
	}
	if n > updateMaxBytes {
		_ = f.Close()
		return stagedUpdate{}, fmt.Errorf("download larger than %d MB", updateMaxBytes>>20)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return stagedUpdate{}, err
	}
	if err := f.Close(); err != nil {
		return stagedUpdate{}, err
	}

	want := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(asset.Digest)), "sha256:")
	got := hex.EncodeToString(h.Sum(nil))
	if want == "" || got != want {
		return stagedUpdate{}, fmt.Errorf("checksum mismatch")
	}

	staged, err := extractBundle(archive, filepath.Join(work, "root"))
	if err != nil {
		return stagedUpdate{}, err
	}
	_ = os.Remove(archive)
	staged.WorkDir = work
	keep = true
	return staged, nil
}

func extractBundle(archive, dest string) (stagedUpdate, error) {
	f, err := os.Open(archive)
	if err != nil {
		return stagedUpdate{}, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return stagedUpdate{}, err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	var total int64
	entries := 0
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return stagedUpdate{}, err
		}
		name := filepath.Clean(strings.TrimPrefix(h.Name, "./"))
		if name == "." {
			continue
		}
		full := filepath.Join(dest, name)
		if filepath.IsAbs(name) || name == ".." ||
			strings.HasPrefix(name, ".."+string(os.PathSeparator)) ||
			(full != dest && !strings.HasPrefix(full, dest+string(os.PathSeparator))) {
			return stagedUpdate{}, fmt.Errorf("unsafe archive path %q", h.Name)
		}
		entries++
		if entries > 20000 {
			return stagedUpdate{}, fmt.Errorf("archive has too many entries")
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(full, 0o755); err != nil {
				return stagedUpdate{}, err
			}
		case tar.TypeReg:
			if h.Size < 0 {
				return stagedUpdate{}, fmt.Errorf("invalid archive entry %q", h.Name)
			}
			total += h.Size
			if total > updateMaxUnpacked {
				return stagedUpdate{}, fmt.Errorf("archive unpacks larger than %d MB", updateMaxUnpacked>>20)
			}
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				return stagedUpdate{}, err
			}
			out, err := os.OpenFile(full, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
			if err != nil {
				return stagedUpdate{}, err
			}
			if _, err := io.Copy(out, tr); err != nil {
				_ = out.Close()
				return stagedUpdate{}, err
			}
			if err := out.Close(); err != nil {
				return stagedUpdate{}, err
			}
		default:
			return stagedUpdate{}, fmt.Errorf("unsupported archive entry %q", h.Name)
		}
	}

	bin := filepath.Join(dest, "arutosiod")
	info, err := os.Stat(bin)
	if err != nil || !info.Mode().IsRegular() {
		return stagedUpdate{}, fmt.Errorf("archive has no arutosiod binary")
	}
	bf, err := os.Open(bin)
	if err != nil {
		return stagedUpdate{}, err
	}
	magic := make([]byte, 4)
	_, readErr := io.ReadFull(bf, magic)
	_ = bf.Close()
	if readErr != nil || string(magic) != "\x7fELF" {
		return stagedUpdate{}, fmt.Errorf("downloaded file is not a Linux binary")
	}
	if err := os.Chmod(bin, 0o755); err != nil {
		return stagedUpdate{}, err
	}

	web := filepath.Join(dest, "web")
	if st, err := os.Stat(filepath.Join(web, "index.html")); err != nil || !st.Mode().IsRegular() {
		web = ""
	}
	return stagedUpdate{Binary: bin, Web: web}, nil
}

func (s *server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	force := r.URL.Query().Get("force") == "1"
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.getUpdate(ctx, force).Status)
}

func (s *server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.updateApply.Lock()
	defer s.updateApply.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	res := s.getUpdate(ctx, true)
	switch {
	case res.Status.Error != "":
		fsError(w, http.StatusBadGateway, res.Status.Error)
		return
	case !res.Status.Available:
		fsError(w, http.StatusConflict, "already up to date")
		return
	case !res.Status.CanApply:
		fsError(w, http.StatusConflict, res.Status.Reason)
		return
	}

	exe, err := updateExecutable()
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	staged, err := s.stageUpdate(ctx, res.Asset, filepath.Dir(exe))
	if err != nil {
		fsError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer func() { _ = os.RemoveAll(staged.WorkDir) }()

	managedWeb := s.managedWebDir()
	if managedWeb && staged.Web == "" {
		fsError(w, http.StatusBadGateway, "release has no web bundle")
		return
	}

	// Refuse to install a binary that cannot even print its usage.
	checkCtx, checkCancel := context.WithTimeout(r.Context(), 5*time.Second)
	_, checkErr := exec.CommandContext(checkCtx, staged.Binary, "-h").CombinedOutput()
	checkCancel()
	if checkErr != nil {
		fsError(w, http.StatusBadGateway, "downloaded binary failed to start: "+checkErr.Error())
		return
	}

	webBackup := s.web + ".old"
	webSwapped := false
	if managedWeb {
		_ = os.RemoveAll(webBackup)
		if err := os.Rename(s.web, webBackup); err != nil {
			fsError(w, http.StatusInternalServerError, "replace site: "+err.Error())
			return
		}
		if err := os.Rename(staged.Web, s.web); err != nil {
			_ = os.Rename(webBackup, s.web)
			fsError(w, http.StatusInternalServerError, "replace site: "+err.Error())
			return
		}
		webSwapped = true
	}

	rollbackWeb := func() {
		if !webSwapped {
			return
		}
		_ = os.RemoveAll(s.web)
		_ = os.Rename(webBackup, s.web)
	}

	backup := exe + ".old"
	_ = os.Remove(backup)
	if err := backupFile(exe, backup); err != nil {
		rollbackWeb()
		fsError(w, http.StatusInternalServerError, "backup binary: "+err.Error())
		return
	}
	if err := os.Rename(staged.Binary, exe); err != nil {
		_ = os.Remove(backup)
		rollbackWeb()
		fsError(w, http.StatusInternalServerError, "replace binary: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": res.Status.Latest, "restarting": true})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(400 * time.Millisecond)
		if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
			log.Printf("update: restart failed: %v", err)
			_ = os.Rename(backup, exe)
			rollbackWeb()
		}
	}()
}

func (s *server) handleUpdateRollback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.updateApply.Lock()
	defer s.updateApply.Unlock()

	exe, err := updateExecutable()
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	targetVersion, ok := s.rollbackInfoFor(exe)
	if !ok {
		fsError(w, http.StatusConflict, "no rollback available")
		return
	}

	managedWeb := s.managedWebDir()
	webRollback := s.web + ".rollback"
	if managedWeb {
		_ = os.RemoveAll(webRollback)
		if err := os.Rename(s.web, webRollback); err != nil {
			fsError(w, http.StatusInternalServerError, "restore site: "+err.Error())
			return
		}
		if err := os.Rename(s.web+".old", s.web); err != nil {
			_ = os.Rename(webRollback, s.web)
			fsError(w, http.StatusInternalServerError, "restore site: "+err.Error())
			return
		}
	}
	restoreWeb := func() {
		if !managedWeb {
			return
		}
		_ = os.RemoveAll(s.web)
		_ = os.Rename(webRollback, s.web)
	}

	failed := exe + ".rollback"
	_ = os.Remove(failed)
	if err := backupFile(exe, failed); err != nil {
		restoreWeb()
		fsError(w, http.StatusInternalServerError, "backup binary: "+err.Error())
		return
	}
	if err := os.Rename(exe+".old", exe); err != nil {
		_ = os.Remove(failed)
		restoreWeb()
		fsError(w, http.StatusInternalServerError, "restore binary: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": targetVersion, "restarting": true})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(400 * time.Millisecond)
		if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
			log.Printf("rollback: restart failed: %v", err)
			// Put the failed build back so disk and process agree again.
			_ = os.Remove(exe + ".old")
			_ = backupFile(exe, exe+".old")
			_ = os.Rename(failed, exe)
			restoreWeb()
		}
	}()
}

// Server fields used by the update handlers live here so main.go stays short.
type updateState struct {
	updateURL    string
	updateMu     sync.Mutex
	updateCache  *updateResult
	updateAt     time.Time
	updateApply  sync.Mutex
	updateClient *http.Client
}
