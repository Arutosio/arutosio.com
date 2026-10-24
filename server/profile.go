package main

import (
	"archive/zip"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var safeIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func safeID(id string) bool {
	return len(id) > 0 && len(id) <= 128 && safeIDRe.MatchString(id) && id != "." && id != ".."
}

func (s *server) handleProfileLocalStorage(w http.ResponseWriter, r *http.Request) {
	s.handleJSONFile(w, r, filepath.Join(s.profileDir, "localStorage.json"), 2<<20)
}

func (s *server) handleProfileApp(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/profile/apps/")
	if !safeID(id) {
		fsError(w, http.StatusBadRequest, "invalid app id")
		return
	}
	s.handleJSONFile(w, r, filepath.Join(s.profileDir, "apps", id+".json"), 8<<20)
}

func (s *server) handleProfileSession(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/profile/session/")
	if !safeID(id) {
		fsError(w, http.StatusBadRequest, "invalid device id")
		return
	}
	s.handleJSONFile(w, r, filepath.Join(s.profileDir, "sessions", id+".json"), 1<<20)
}

func (s *server) handleProfileAppearance(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/api/profile/appearance/")
	if !safeID(key) {
		fsError(w, http.StatusBadRequest, "invalid appearance key")
		return
	}
	path := filepath.Join(s.profileDir, "appearance", key+".bin")
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil {
			fsError(w, http.StatusNotFound, "not found")
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			fsError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := writeAtomicBytes(path, data, 0o600); err != nil {
			fsError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "size": len(data)})
	default:
		w.Header().Set("Allow", "GET, PUT")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *server) handleJSONFile(w http.ResponseWriter, r *http.Request, path string, limit int64) {
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil {
			fsError(w, http.StatusNotFound, "not found")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			fsError(w, http.StatusBadRequest, err.Error())
			return
		}
		var obj map[string]any
		if err := json.Unmarshal(data, &obj); err != nil {
			fsError(w, http.StatusBadRequest, "json object required")
			return
		}
		if err := writeAtomicBytes(path, data, 0o600); err != nil {
			fsError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"size":      len(data),
			"updatedAt": time.Now().UTC(),
		})
	default:
		w.Header().Set("Allow", "GET, PUT")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *server) handleProfileExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		fsError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="arutosio-profile.zip"`)
	w.Header().Set("Cache-Control", "no-store")
	zw := zip.NewWriter(w)
	defer zw.Close()
	_ = filepath.WalkDir(s.profileDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(s.profileDir, path)
		if err != nil {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return nil
		}
		header.Name = filepath.ToSlash(rel)
		header.Method = zip.Deflate
		dst, err := zw.CreateHeader(header)
		if err != nil {
			return nil
		}
		src, err := os.Open(path)
		if err != nil {
			return nil
		}
		_, _ = io.Copy(dst, src)
		_ = src.Close()
		return nil
	})
}

func writeAtomicBytes(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".arutosio-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(name)
	}
	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Chmod(name, mode); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
