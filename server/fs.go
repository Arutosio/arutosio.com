package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type entry struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Size    int64  `json:"size,omitempty"`
	ModTime string `json:"mtime,omitempty"`
	Mode    string `json:"mode,omitempty"`
	Link    string `json:"link,omitempty"`
}

func (s *server) handleFSRoots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"roots": []map[string]any{{
			"id":       "home",
			"label":    "Home",
			"path":     s.root,
			"writable": true,
		}},
	})
}

func (s *server) handleFSList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	full, rel, err := s.resolvePath(r.URL.Query().Get("path"))
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := os.Stat(full)
	if err != nil {
		fsError(w, http.StatusNotFound, "not found")
		return
	}
	if !st.IsDir() {
		fsError(w, http.StatusBadRequest, "not a directory")
		return
	}
	dir, err := os.Open(full)
	if err != nil {
		fsError(w, http.StatusForbidden, err.Error())
		return
	}
	defer dir.Close()
	names, err := dir.Readdirnames(-1)
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]entry, 0, len(names))
	for _, name := range names {
		p := filepath.Join(full, name)
		info, err := os.Lstat(p)
		if err != nil {
			continue
		}
		e := entry{
			Name:    name,
			ModTime: info.ModTime().UTC().Format(time.RFC3339),
			Mode:    info.Mode().String(),
		}
		switch {
		case info.IsDir():
			e.Kind = "dir"
		case info.Mode()&os.ModeSymlink != 0:
			e.Kind = "symlink"
			if target, err := os.Readlink(p); err == nil {
				e.Link = target
			}
		default:
			e.Kind = "file"
			e.Size = info.Size()
		}
		out = append(out, e)
	}
	sortEntries(out)
	writeJSON(w, http.StatusOK, map[string]any{
		"root":    s.root,
		"path":    filepath.ToSlash(rel),
		"entries": out,
	})
}

func (s *server) handleFSStat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	full, rel, err := s.resolvePath(r.URL.Query().Get("path"))
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	fi, err := os.Stat(full)
	if err != nil {
		fsError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, statPayload(rel, fi))
}

func (s *server) handleFSRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	full, _, err := s.resolvePath(r.URL.Query().Get("path"))
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	fi, err := os.Stat(full)
	if err != nil {
		fsError(w, http.StatusNotFound, "not found")
		return
	}
	if fi.IsDir() {
		fsError(w, http.StatusBadRequest, "is a directory")
		return
	}
	max := int64(8 << 20)
	if raw := r.URL.Query().Get("max"); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			max = n
		}
	}
	if max > 64<<20 {
		max = 64 << 20
	}
	if fi.Size() > max {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{
			"error": "file too large",
			"size":  fi.Size(),
			"max":   max,
		})
		return
	}
	data, err := os.ReadFile(full)
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(full))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("ETag", `"`+etagValue(fi)+`"`)
	w.Header().Set("X-Arutosio-ETag", etagValue(fi))
	w.Header().Set("X-Arutosio-Mtime", fi.ModTime().UTC().Format(time.RFC3339Nano))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (s *server) handleFSDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	full, _, err := s.resolvePath(r.URL.Query().Get("path"))
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	fi, err := os.Stat(full)
	if err != nil || fi.IsDir() {
		fsError(w, http.StatusNotFound, "not found")
		return
	}
	f, err := os.Open(full)
	if err != nil {
		fsError(w, http.StatusForbidden, err.Error())
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentTypeFor(full))
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fi.Name()}))
	w.Header().Set("ETag", `"`+etagValue(fi)+`"`)
	w.Header().Set("X-Arutosio-ETag", etagValue(fi))
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
}

func (s *server) handleFSWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", "PUT")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.writeFile(w, r, false)
}

func (s *server) handleFSUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	overwrite := r.URL.Query().Get("overwrite") == "1"
	s.writeFile(w, r, !overwrite)
}

func (s *server) writeFile(w http.ResponseWriter, r *http.Request, createOnly bool) {
	full, rel, err := s.resolvePathForWrite(r.URL.Query().Get("path"))
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	fi, statErr := os.Stat(full)
	exists := statErr == nil
	if createOnly && exists {
		fsError(w, http.StatusConflict, "file already exists")
		return
	}
	ifMatch := strings.Trim(r.Header.Get("If-Match"), `"`)
	if ifMatch != "" {
		if ifMatch == "*" {
			if exists {
				fsError(w, http.StatusConflict, "file already exists")
				return
			}
		} else {
			if !exists {
				fsError(w, http.StatusConflict, "file no longer exists")
				return
			}
			if ifMatch != etagValue(fi) {
				writeJSON(w, http.StatusConflict, map[string]any{
					"error": "file changed",
					"etag":  etagValue(fi),
				})
				return
			}
		}
	}
	mode := os.FileMode(0o644)
	if exists && !fi.IsDir() {
		mode = fi.Mode().Perm()
	}
	body := http.MaxBytesReader(w, r.Body, 2<<30)
	out, err := writeAtomic(full, body, mode)
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, statPayload(rel, out))
}

func (s *server) handleFSMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	full, rel, err := s.resolvePathForCreate(req.Path)
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := os.Lstat(full); err == nil {
		fsError(w, http.StatusConflict, "already exists")
		return
	}
	if err := os.Mkdir(full, 0o755); err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	fi, err := os.Stat(full)
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, statPayload(rel, fi))
}

func (s *server) handleFSRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	fromFull, _, err := s.resolveEntry(req.From)
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	toFull, toRel, err := s.resolvePathForCreate(req.To)
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := os.Lstat(toFull); err == nil {
		fsError(w, http.StatusConflict, "destination exists")
		return
	}
	if err := os.Rename(fromFull, toFull); err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	fi, err := os.Stat(toFull)
	if err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, statPayload(toRel, fi))
}

func (s *server) handleFSDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Path    string `json:"path"`
		Trash   *bool  `json:"trash"`
		Confirm bool   `json:"confirm"`
	}
	if !parseJSONBody(w, r, &req) {
		return
	}
	full, rel, err := s.resolveEntry(req.Path)
	if err != nil {
		fsError(w, http.StatusBadRequest, err.Error())
		return
	}
	if rel == "" {
		fsError(w, http.StatusBadRequest, "cannot delete the root")
		return
	}
	useTrash := true
	if req.Trash != nil {
		useTrash = *req.Trash
	}
	if !useTrash {
		if !req.Confirm {
			fsError(w, http.StatusBadRequest, "permanent delete requires confirmation")
			return
		}
		if err := os.RemoveAll(full); err != nil {
			fsError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trashed": false, "path": filepath.ToSlash(rel)})
		return
	}
	dir := filepath.Join(s.trashDir, fmt.Sprintf("%d-%s", time.Now().UnixNano(), randomHex(4)))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	dest := filepath.Join(dir, filepath.Base(full))
	if err := os.Rename(full, dest); err != nil {
		_ = os.RemoveAll(dir)
		fsError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Keep the original path so the System app can restore the entry.
	if meta, err := json.Marshal(map[string]any{
		"original":  filepath.ToSlash(rel),
		"name":      filepath.Base(full),
		"deletedAt": time.Now().UTC(),
	}); err == nil {
		_ = os.WriteFile(filepath.Join(dir, "meta.json"), meta, 0o600)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"trashed":   true,
		"path":      filepath.ToSlash(rel),
		"trashPath": filepath.ToSlash(dest),
	})
}

func (s *server) resolvePath(p string) (string, string, error) {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "/")
	if strings.ContainsRune(p, 0) {
		return "", "", errors.New("invalid path")
	}
	clean := filepath.Clean(p)
	if clean == "." {
		clean = ""
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", "", errors.New("path escapes root")
	}
	full := filepath.Join(s.root, clean)
	real, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", "", err
	}
	if !within(s.root, real) {
		return "", "", errors.New("path escapes root")
	}
	rel, err := filepath.Rel(s.root, real)
	if err != nil {
		return "", "", err
	}
	if rel == "." {
		rel = ""
	}
	return real, rel, nil
}

// resolveEntry resolves a path without following its final component, so a
// dangling symlink can still be listed, renamed or deleted. The parent is
// resolved and checked, which keeps deletes inside the root.
func (s *server) resolveEntry(p string) (string, string, error) {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "/")
	if strings.ContainsRune(p, 0) {
		return "", "", errors.New("invalid path")
	}
	clean := filepath.Clean(p)
	if clean == "." || clean == "" {
		return "", "", errors.New("path required")
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", "", errors.New("path escapes root")
	}
	full := filepath.Join(s.root, clean)
	realParent, err := filepath.EvalSymlinks(filepath.Dir(full))
	if err != nil {
		return "", "", err
	}
	if !within(s.root, realParent) {
		return "", "", errors.New("path escapes root")
	}
	full = filepath.Join(realParent, filepath.Base(full))
	rel, err := filepath.Rel(s.root, full)
	if err != nil {
		return "", "", err
	}
	return full, filepath.ToSlash(rel), nil
}

func (s *server) resolvePathForCreate(p string) (string, string, error) {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "/")
	if strings.ContainsRune(p, 0) {
		return "", "", errors.New("invalid path")
	}
	clean := filepath.Clean(p)
	if clean == "." || clean == "" {
		return "", "", errors.New("path required")
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", "", errors.New("path escapes root")
	}
	full := filepath.Join(s.root, clean)
	parent, err := filepath.EvalSymlinks(filepath.Dir(full))
	if err != nil {
		return "", "", err
	}
	if !within(s.root, parent) {
		return "", "", errors.New("path escapes root")
	}
	full = filepath.Join(parent, filepath.Base(full))
	rel, err := filepath.Rel(s.root, full)
	if err != nil {
		return "", "", err
	}
	return full, rel, nil
}

func (s *server) resolvePathForWrite(p string) (string, string, error) {
	full, rel, err := s.resolvePathForCreate(p)
	if err != nil {
		return "", "", err
	}
	fi, err := os.Lstat(full)
	if err != nil {
		return full, rel, nil
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		real, err := filepath.EvalSymlinks(full)
		if err != nil {
			return "", "", err
		}
		if !within(s.root, real) {
			return "", "", errors.New("path escapes root")
		}
		full = real
		rel, _ = filepath.Rel(s.root, full)
	}
	if fi.IsDir() {
		return "", "", errors.New("is a directory")
	}
	return full, rel, nil
}

func within(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func writeAtomic(full string, src io.Reader, mode os.FileMode) (os.FileInfo, error) {
	dir := filepath.Dir(full)
	tmp, err := os.CreateTemp(dir, ".arutosio-*")
	if err != nil {
		return nil, err
	}
	name := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(name)
	}
	if _, err := io.Copy(tmp, src); err != nil {
		cleanup()
		return nil, err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return nil, err
	}
	if err := os.Chmod(name, mode); err != nil {
		_ = os.Remove(name)
		return nil, err
	}
	if err := os.Rename(name, full); err != nil {
		_ = os.Remove(name)
		return nil, err
	}
	return os.Stat(full)
}

func etagValue(fi os.FileInfo) string {
	return fmt.Sprintf("%x-%x", fi.ModTime().UnixNano(), fi.Size())
}

func statPayload(rel string, fi os.FileInfo) map[string]any {
	kind := "file"
	switch {
	case fi.IsDir():
		kind = "dir"
	case fi.Mode()&os.ModeSymlink != 0:
		kind = "symlink"
	}
	return map[string]any{
		"path":  filepath.ToSlash(rel),
		"kind":  kind,
		"size":  fi.Size(),
		"mode":  fi.Mode().String(),
		"mtime": fi.ModTime().UTC().Format(time.RFC3339Nano),
		"etag":  etagValue(fi),
	}
}

var textExt = map[string]bool{
	".txt": true, ".md": true, ".markdown": true, ".json": true,
	".js": true, ".mjs": true, ".cjs": true, ".ts": true, ".tsx": true,
	".jsx": true, ".css": true, ".scss": true, ".sass": true,
	".html": true, ".htm": true, ".xml": true, ".yml": true, ".yaml": true,
	".csv": true, ".log": true, ".ini": true, ".toml": true, ".env": true,
	".sh": true, ".bash": true, ".zsh": true, ".py": true, ".rb": true,
	".rs": true, ".go": true, ".c": true, ".h": true, ".cpp": true,
	".hpp": true, ".java": true, ".kt": true, ".swift": true, ".php": true,
	".sql": true, ".conf": true, ".service": true, ".desktop": true,
}

func contentTypeFor(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".json" {
		return "application/json; charset=utf-8"
	}
	if ext == ".js" || ext == ".mjs" {
		return "text/javascript; charset=utf-8"
	}
	if ext == ".css" {
		return "text/css; charset=utf-8"
	}
	if ext == ".html" || ext == ".htm" {
		return "text/html; charset=utf-8"
	}
	if ext == ".svg" {
		return "image/svg+xml"
	}
	if ext == ".xml" {
		return "application/xml; charset=utf-8"
	}
	if textExt[ext] {
		return "text/plain; charset=utf-8"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func sortEntries(out []entry) {
	// Small insertion sort keeps dirs first, then symlinks, then files.
	rank := func(kind string) int {
		switch kind {
		case "dir":
			return 0
		case "symlink":
			return 1
		default:
			return 2
		}
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			a, b := out[j-1], out[j]
			if rank(a.Kind) < rank(b.Kind) || (rank(a.Kind) == rank(b.Kind) && strings.ToLower(a.Name) <= strings.ToLower(b.Name)) {
				break
			}
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
}

func fsError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func parseJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		fsError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}
