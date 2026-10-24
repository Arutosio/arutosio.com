package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWithin(t *testing.T) {
	root := string(filepath.Separator) + filepath.Join("home", "user")
	cases := []struct {
		path string
		want bool
	}{
		{filepath.Join(root, "a"), true},
		{filepath.Join(root, "a", "b"), true},
		{filepath.Join(root, "..", "other"), false},
		{root + "x", false},
	}
	for _, c := range cases {
		if got := within(root, c.path); got != c.want {
			t.Errorf("within(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

func TestResolvePath(t *testing.T) {
	root := t.TempDir()
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(realRoot, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realRoot, "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(realRoot, "escape")
	if err := os.Symlink(string(filepath.Separator)+"etc", escape); err != nil {
		t.Logf("symlink unavailable: %v", err)
		escape = ""
	}

	s := &server{root: realRoot}
	ok := []string{"", ".", "sub", "a.txt", "/sub"}
	for _, p := range ok {
		if _, _, err := s.resolvePath(p); err != nil {
			t.Errorf("resolvePath(%q) unexpected error: %v", p, err)
		}
	}
	bad := []string{"..", "../etc", "sub/../../etc"}
	if escape != "" {
		bad = append(bad, "escape")
	}
	for _, p := range bad {
		if _, _, err := s.resolvePath(p); err == nil {
			t.Errorf("resolvePath(%q) succeeded, want escape error", p)
		}
	}
}

func TestOriginAllowed(t *testing.T) {
	cases := []struct {
		origin string
		want   bool
	}{
		{"", true},
		{"http://localhost:7777", true},
		{"https://localhost:7777", true},
		{"http://localhost:7778", false},
		{"http://evil.example", false},
		{"null", false},
	}
	for _, c := range cases {
		if got := originAllowed(c.origin, "localhost:7777"); got != c.want {
			t.Errorf("originAllowed(%q) = %v, want %v", c.origin, got, c.want)
		}
	}
}

func TestWithAuth(t *testing.T) {
	s := &server{token: "secret"}
	h := s.withAuth(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })

	for _, tc := range []struct {
		name string
		url  string
		auth string
		want int
	}{
		{"query", "/?token=secret", "", http.StatusNoContent},
		{"bearer", "/", "Bearer secret", http.StatusNoContent},
		{"missing", "/", "", http.StatusUnauthorized},
		{"wrong", "/?token=nope", "", http.StatusUnauthorized},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.url, nil)
		if tc.auth != "" {
			req.Header.Set("Authorization", tc.auth)
		}
		rec := httptest.NewRecorder()
		h(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, rec.Code, tc.want)
		}
	}
}

func TestDisplayAddr(t *testing.T) {
	for in, want := range map[string]string{
		"0.0.0.0:7777":   "127.0.0.1:7777",
		":7777":          "127.0.0.1:7777",
		"localhost:7777": "localhost:7777",
	} {
		if got := displayAddr(in); got != want {
			t.Errorf("displayAddr(%q) = %q, want %q", in, got, want)
		}
	}
	if !strings.Contains(displayAddr("127.0.0.1:7777"), "127.0.0.1") {
		t.Error("displayAddr lost loopback address")
	}
}

func TestFSWriteReadCreateOnlyAndTrash(t *testing.T) {
	root := t.TempDir()
	trash := t.TempDir()
	s := &server{root: root, trashDir: trash}

	put := func(path, body, ifMatch string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/fs/write?path="+path, strings.NewReader(body))
		if ifMatch != "" {
			req.Header.Set("If-Match", ifMatch)
		}
		rec := httptest.NewRecorder()
		s.handleFSWrite(rec, req)
		return rec
	}

	rec := put("note.txt", "hello", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("write status %d: %s", rec.Code, rec.Body.String())
	}
	var stat map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &stat); err != nil {
		t.Fatal(err)
	}
	etag, _ := stat["etag"].(string)
	if etag == "" {
		t.Fatal("missing etag")
	}

	read := httptest.NewRecorder()
	s.handleFSRead(read, httptest.NewRequest(http.MethodGet, "/api/fs/read?path=note.txt", nil))
	if read.Code != http.StatusOK || read.Body.String() != "hello" {
		t.Fatalf("read %d: %q", read.Code, read.Body.String())
	}

	if rec := put("note.txt", "nope", "*"); rec.Code != http.StatusConflict {
		t.Fatalf("create-only existing status %d, want 409", rec.Code)
	}
	if rec := put("created.txt", "new", "*"); rec.Code != http.StatusOK {
		t.Fatalf("create-only new status %d: %s", rec.Code, rec.Body.String())
	}
	if rec := put("note.txt", "changed", etag); rec.Code != http.StatusOK {
		t.Fatalf("if-match status %d: %s", rec.Code, rec.Body.String())
	}
	if rec := put("note.txt", "stale", etag); rec.Code != http.StatusConflict {
		t.Fatalf("stale if-match status %d, want 409", rec.Code)
	}

	del := httptest.NewRecorder()
	s.handleFSDelete(del, httptest.NewRequest(http.MethodPost, "/api/fs/delete",
		strings.NewReader(`{"path":"created.txt"}`)))
	if del.Code != http.StatusOK {
		t.Fatalf("delete status %d: %s", del.Code, del.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "created.txt")); !os.IsNotExist(err) {
		t.Fatal("file still in root after trash")
	}
	matches, _ := filepath.Glob(filepath.Join(trash, "*", "created.txt"))
	if len(matches) != 1 {
		t.Fatalf("trash copies = %d, want 1", len(matches))
	}

	list := httptest.NewRecorder()
	s.handleSystemTrashList(list, httptest.NewRequest(http.MethodGet, "/api/system/trash/list", nil))
	if list.Code != http.StatusOK {
		t.Fatalf("trash list status %d: %s", list.Code, list.Body.String())
	}
	var listed struct {
		Entries []trashEntry `json:"entries"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	var id string
	for _, e := range listed.Entries {
		if e.Original == "created.txt" {
			id = e.ID
		}
	}
	if id == "" {
		t.Fatalf("trash entry not listed: %s", list.Body.String())
	}
	restore := httptest.NewRecorder()
	s.handleSystemTrashRestore(restore, httptest.NewRequest(http.MethodPost, "/api/system/trash/restore",
		strings.NewReader(`{"id":"`+id+`"}`)))
	if restore.Code != http.StatusOK {
		t.Fatalf("trash restore status %d: %s", restore.Code, restore.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(root, "created.txt"))
	if err != nil || string(data) != "new" {
		t.Fatalf("restored file = %q, %v", string(data), err)
	}
}

func TestProfileJSON(t *testing.T) {
	s := &server{profileDir: t.TempDir()}
	put := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/profile/localStorage", strings.NewReader(`{"arutosio_theme":"light"}`))
	s.handleProfileLocalStorage(put, req)
	if put.Code != http.StatusOK {
		t.Fatalf("put status %d: %s", put.Code, put.Body.String())
	}
	get := httptest.NewRecorder()
	s.handleProfileLocalStorage(get, httptest.NewRequest(http.MethodGet, "/api/profile/localStorage", nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"light"`) {
		t.Fatalf("get %d: %s", get.Code, get.Body.String())
	}
	bad := httptest.NewRecorder()
	s.handleProfileLocalStorage(bad, httptest.NewRequest(http.MethodPut, "/api/profile/localStorage", strings.NewReader(`[1]`)))
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("array body status %d, want 400", bad.Code)
	}
}

func TestCookieLoginAndCSRF(t *testing.T) {
	s := &server{token: "secret", sessions: make(map[string]session)}
	login := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"token":"secret"}`))
	s.handleLogin(login, req)
	if login.Code != http.StatusOK {
		t.Fatalf("login status %d: %s", login.Code, login.Body.String())
	}
	var body struct {
		CSRF string `json:"csrf"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &body); err != nil || body.CSRF == "" {
		t.Fatalf("missing csrf: %s", login.Body.String())
	}
	cookies := login.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("missing session cookie")
	}

	protected := s.withAuth(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	noCSRF := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/x", nil)
	req.AddCookie(cookies[0])
	protected(noCSRF, req)
	if noCSRF.Code != http.StatusForbidden {
		t.Fatalf("cookie mutation without csrf = %d, want 403", noCSRF.Code)
	}

	withCSRF := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/x", nil)
	req.AddCookie(cookies[0])
	req.Header.Set(csrfHeader, body.CSRF)
	protected(withCSRF, req)
	if withCSRF.Code != http.StatusNoContent {
		t.Fatalf("cookie mutation with csrf = %d, want 204", withCSRF.Code)
	}

	sessionRec := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.AddCookie(cookies[0])
	s.handleSession(sessionRec, req)
	if sessionRec.Code != http.StatusOK {
		t.Fatalf("session status %d: %s", sessionRec.Code, sessionRec.Body.String())
	}
}

func TestSafeID(t *testing.T) {
	for _, id := range []string{"grimoire", "dice-roller", "dev-1", "a.b_c"} {
		if !safeID(id) {
			t.Errorf("safeID(%q) = false", id)
		}
	}
	for _, id := range []string{"", ".", "..", "../x", "a/b", "a\\b"} {
		if safeID(id) {
			t.Errorf("safeID(%q) = true", id)
		}
	}
}
