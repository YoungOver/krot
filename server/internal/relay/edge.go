package relay

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Exchange is what the inspector stores about one proxied request.
type Exchange struct {
	Subdomain string
	Method    string
	Path      string
	Status    int
	Duration  time.Duration
	Size      int64
	RemoteIP  string
	At        time.Time
	ReqHeader http.Header
	ResHeader http.Header
	ReqBody   []byte
	ResBody   []byte
}

type hello struct {
	Token     string `json:"token"`
	Subdomain string `json:"subdomain"`
}

// Edge accepts agent connections and serves public HTTP for their subdomains.
type Edge struct {
	Domain       string                                                  // e.g. "krot.localhost:8080"
	Authenticate func(token, subdomain string) (owner string, err error) // decides who may claim a subdomain
	Record       func(Exchange)
	Log          *slog.Logger

	mu     sync.RWMutex
	agents map[string]*session // subdomain -> session
}

const captureLimit = 64 << 10

// ServeAgents accepts agent connections on ln until it is closed.
func (e *Edge) ServeAgents(ln net.Listener) error {
	for {
		c, err := ln.Accept()
		if err != nil {
			return err
		}
		go e.handleAgent(c)
	}
}

func (e *Edge) handleAgent(c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	f, err := readFrame(br)
	if err != nil || f.typ != frameHello {
		return
	}
	c.SetReadDeadline(time.Time{})
	var h hello
	s := newSession(c)
	reject := func(msg string) { s.send(frame{typ: frameError, payload: []byte(msg)}) }
	if json.Unmarshal(f.payload, &h) != nil {
		reject("bad hello")
		return
	}
	if _, err := e.Authenticate(h.Token, h.Subdomain); err != nil {
		reject(err.Error())
		return
	}
	e.mu.Lock()
	if e.agents == nil {
		e.agents = map[string]*session{}
	}
	if _, busy := e.agents[h.Subdomain]; busy {
		e.mu.Unlock()
		reject("subdomain is already connected from another agent")
		return
	}
	e.agents[h.Subdomain] = s
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		delete(e.agents, h.Subdomain)
		e.mu.Unlock()
	}()

	url := fmt.Sprintf("http://%s.%s", h.Subdomain, e.Domain)
	if err := s.send(frame{typ: frameHelloOK, payload: []byte(url)}); err != nil {
		return
	}
	e.log().Info("agent connected", "subdomain", h.Subdomain, "remote", c.RemoteAddr().String())
	err = s.serve(br)
	e.log().Info("agent disconnected", "subdomain", h.Subdomain, "err", err)
}

func (e *Edge) log() *slog.Logger {
	if e.Log != nil {
		return e.Log
	}
	return slog.Default()
}

// Online reports whether an agent currently serves the subdomain.
func (e *Edge) Online(sub string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	_, ok := e.agents[sub]
	return ok
}

// capture keeps the first captureLimit bytes that pass through it.
type capture struct {
	buf bytes.Buffer
	n   int64
}

func (c *capture) Write(p []byte) (int, error) {
	if room := captureLimit - c.buf.Len(); room > 0 {
		c.buf.Write(p[:min(len(p), room)])
	}
	c.n += int64(len(p))
	return len(p), nil
}

// ServeHTTP proxies a public request to the agent that owns the Host's subdomain.
func (e *Edge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	sub, _, _ := strings.Cut(r.Host, ".")
	e.mu.RLock()
	s := e.agents[sub]
	e.mu.RUnlock()
	if s == nil {
		http.Error(w, "Туннель "+sub+" сейчас не подключён", http.StatusBadGateway)
		return
	}

	var reqBody capture
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.TeeReader(r.Body, &reqBody), r.Body}
	st, err := s.open()
	if err != nil {
		http.Error(w, "agent unavailable", http.StatusBadGateway)
		return
	}
	out := r.Clone(r.Context())
	out.RequestURI = ""
	out.Close = true // one exchange per stream: the local server closes after responding
	out.Header.Set("X-Forwarded-For", clientIP(r))
	out.Header.Set("X-Forwarded-Proto", "http")
	go func() {
		out.Write(st)
		st.CloseWrite()
	}()

	res, err := http.ReadResponse(bufio.NewReader(st), out)
	if err != nil {
		http.Error(w, "Локальный сервер не ответил: "+err.Error(), http.StatusBadGateway)
		e.record(sub, r, &reqBody, nil, nil, http.StatusBadGateway, start)
		return
	}
	defer res.Body.Close()
	for k, v := range res.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(res.StatusCode)
	var resBody capture
	io.Copy(io.MultiWriter(w, &resBody), res.Body)
	e.record(sub, r, &reqBody, res.Header, &resBody, res.StatusCode, start)
}

func (e *Edge) record(sub string, r *http.Request, req *capture, resH http.Header, res *capture, status int, start time.Time) {
	if e.Record == nil {
		return
	}
	x := Exchange{
		Subdomain: sub, Method: r.Method, Path: r.URL.RequestURI(), Status: status,
		Duration: time.Since(start), RemoteIP: clientIP(r), At: start, ReqHeader: r.Header.Clone(), ResHeader: resH,
		ReqBody: bytes.Clone(req.buf.Bytes()),
	}
	if res != nil {
		x.Size = res.n
		x.ResBody = bytes.Clone(res.buf.Bytes())
	}
	e.Record(x)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ErrRejected is returned by Dial when the edge refuses the handshake.
var ErrRejected = errors.New("relay: rejected by edge")
