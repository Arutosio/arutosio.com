package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

const (
	termBufferMax  = 512 * 1024
	termQueueDepth = 64
)

var termIDRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

type termFrame struct {
	typ   websocket.MessageType
	data  []byte
	final bool
}

type termClient struct {
	c    *websocket.Conn
	out  chan termFrame
	done chan struct{}
	once sync.Once
}

func newTermClient(c *websocket.Conn) *termClient {
	return &termClient{
		c:    c,
		out:  make(chan termFrame, termQueueDepth),
		done: make(chan struct{}),
	}
}

func (cl *termClient) enqueue(f termFrame) bool {
	select {
	case cl.out <- f:
		return true
	default:
		cl.close()
		return false
	}
}

func (cl *termClient) close() {
	cl.once.Do(func() {
		close(cl.done)
		_ = cl.c.CloseNow()
	})
}

func (cl *termClient) writer(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			cl.close()
			return
		case <-cl.done:
			return
		case f := <-cl.out:
			wctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := cl.c.Write(wctx, f.typ, f.data)
			cancel()
			if err != nil {
				cl.close()
				return
			}
			if f.final {
				_ = cl.c.Close(websocket.StatusNormalClosure, "")
				cl.close()
				return
			}
		}
	}
}

type termSession struct {
	id     string
	ptmx   *os.File
	cmd    *exec.Cmd
	waitCh chan error

	mu       sync.Mutex
	clients  map[*termClient]struct{}
	buf      []byte
	lastUsed time.Time
	created  time.Time
	closed   bool
	pid      int
}

func (ts *termSession) isClosed() bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return ts.closed
}

func (ts *termSession) touch() {
	ts.mu.Lock()
	ts.lastUsed = time.Now()
	ts.mu.Unlock()
}

func (ts *termSession) appendLocked(data []byte) {
	ts.buf = append(ts.buf, data...)
	if len(ts.buf) > termBufferMax {
		ts.buf = append([]byte(nil), ts.buf[len(ts.buf)-termBufferMax:]...)
	}
}

func (ts *termSession) attach(cl *termClient) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.closed {
		return
	}
	ts.clients[cl] = struct{}{}
	ts.lastUsed = time.Now()
	if len(ts.buf) > 0 {
		cl.enqueue(termFrame{typ: websocket.MessageBinary, data: append([]byte(nil), ts.buf...)})
	}
}

func (ts *termSession) detach(cl *termClient) {
	ts.mu.Lock()
	delete(ts.clients, cl)
	ts.lastUsed = time.Now()
	ts.mu.Unlock()
	cl.close()
}

func (ts *termSession) write(data []byte) {
	ts.mu.Lock()
	ts.lastUsed = time.Now()
	ts.mu.Unlock()
	if _, err := ts.ptmx.Write(data); err != nil {
		ts.kill()
	}
}

func (ts *termSession) resize(cols, rows int) {
	_ = pty.Setsize(ts.ptmx, &pty.Winsize{
		Cols: uint16(clamp(cols, 2, 500)),
		Rows: uint16(clamp(rows, 2, 300)),
	})
}

func (ts *termSession) kill() {
	_ = ts.ptmx.Close()
	if ts.cmd.Process != nil {
		_ = ts.cmd.Process.Kill()
	}
}

func (ts *termSession) snapshot() (clients int, idle time.Duration) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return len(ts.clients), time.Since(ts.lastUsed)
}

func (s *server) startTerm(id string, cols, rows int) (*termSession, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-l")
	cmd.Dir = s.root
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor", "ARUTOSIO=1")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		cmd = exec.Command(shell)
		cmd.Dir = s.root
		cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor", "ARUTOSIO=1")
		ptmx, err = pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	}
	if err != nil {
		return nil, err
	}
	ts := &termSession{
		id:       id,
		ptmx:     ptmx,
		cmd:      cmd,
		waitCh:   make(chan error, 1),
		clients:  make(map[*termClient]struct{}),
		lastUsed: time.Now(),
		created:  time.Now(),
		pid:      cmd.Process.Pid,
	}
	go func() { ts.waitCh <- cmd.Wait() }()
	go s.termReadLoop(ts)
	return ts, nil
}

func (s *server) getOrStartTerm(id string, cols, rows int) (*termSession, error) {
	s.termMu.Lock()
	defer s.termMu.Unlock()
	if s.terms == nil {
		s.terms = make(map[string]*termSession)
	}
	if ts := s.terms[id]; ts != nil && !ts.isClosed() {
		ts.touch()
		return ts, nil
	}
	ts, err := s.startTerm(id, cols, rows)
	if err != nil {
		return nil, err
	}
	s.terms[id] = ts
	return ts, nil
}

func (s *server) termReadLoop(ts *termSession) {
	defer s.removeTerm(ts.id, ts)
	buf := make([]byte, 32*1024)
	for {
		n, err := ts.ptmx.Read(buf)
		if n > 0 {
			data := append([]byte(nil), buf[:n]...)
			ts.mu.Lock()
			ts.lastUsed = time.Now()
			ts.appendLocked(data)
			clients := make([]*termClient, 0, len(ts.clients))
			for cl := range ts.clients {
				clients = append(clients, cl)
			}
			ts.mu.Unlock()
			for _, cl := range clients {
				cl.enqueue(termFrame{typ: websocket.MessageBinary, data: data})
			}
		}
		if err != nil {
			break
		}
	}
	code := 0
	select {
	case werr := <-ts.waitCh:
		if werr != nil {
			var exit *exec.ExitError
			if errors.As(werr, &exit) {
				code = exit.ExitCode()
			} else {
				code = -1
			}
		}
	case <-time.After(2 * time.Second):
	}
	payload, _ := json.Marshal(map[string]any{"type": "exit", "code": code})
	ts.mu.Lock()
	ts.closed = true
	clients := make([]*termClient, 0, len(ts.clients))
	for cl := range ts.clients {
		clients = append(clients, cl)
	}
	ts.buf = nil
	ts.mu.Unlock()
	for _, cl := range clients {
		cl.enqueue(termFrame{typ: websocket.MessageText, data: payload, final: true})
	}
	_ = ts.ptmx.Close()
}

func (s *server) removeTerm(id string, ts *termSession) {
	s.termMu.Lock()
	if s.terms[id] == ts {
		delete(s.terms, id)
	}
	s.termMu.Unlock()
}

func (s *server) cleanupTerms() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		if s.termIdle <= 0 {
			continue
		}
		var expired []*termSession
		s.termMu.Lock()
		for id, ts := range s.terms {
			clients, idle := ts.snapshot()
			if clients == 0 && idle > s.termIdle {
				expired = append(expired, ts)
				delete(s.terms, id)
			}
		}
		s.termMu.Unlock()
		for _, ts := range expired {
			ts.kill()
		}
	}
}

type termInfo struct {
	ID          string    `json:"id"`
	PID         int       `json:"pid"`
	Clients     int       `json:"clients"`
	IdleSeconds int       `json:"idleSeconds"`
	Created     time.Time `json:"created"`
}

func (s *server) termInfos() []termInfo {
	s.termMu.Lock()
	defer s.termMu.Unlock()
	out := make([]termInfo, 0, len(s.terms))
	for _, ts := range s.terms {
		clients, idle := ts.snapshot()
		out = append(out, termInfo{
			ID:          ts.id,
			PID:         ts.pid,
			Clients:     clients,
			IdleSeconds: int(idle.Seconds()),
			Created:     ts.created,
		})
	}
	return out
}

func (s *server) killTerm(id string) bool {
	s.termMu.Lock()
	ts := s.terms[id]
	delete(s.terms, id)
	s.termMu.Unlock()
	if ts == nil {
		return false
	}
	ts.kill()
	return true
}

func (s *server) handleTerm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !originAllowed(r.Header.Get("Origin"), r.Host) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	cols := clamp(intQuery(r, "cols", 100), 2, 500)
	rows := clamp(intQuery(r, "rows", 30), 2, 300)
	id := r.URL.Query().Get("session")
	if !termIDRe.MatchString(id) {
		id = "main"
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // origin checked above
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		log.Printf("ws accept: %v", err)
		return
	}
	c.SetReadLimit(1 << 20)
	cl := newTermClient(c)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go cl.writer(ctx)
	defer cl.close()

	ts, err := s.getOrStartTerm(id, cols, rows)
	if err != nil {
		payload, _ := json.Marshal(map[string]any{"type": "exit", "code": -1})
		cl.enqueue(termFrame{typ: websocket.MessageText, data: payload, final: true})
		return
	}
	ts.attach(cl)
	defer ts.detach(cl)

	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageText {
			var msg struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" {
				ts.resize(msg.Cols, msg.Rows)
			}
			continue
		}
		ts.write(data)
	}
}

func intQuery(r *http.Request, name string, def int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return n
}

func clamp(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}
