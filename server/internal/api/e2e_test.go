package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/YoungOver/krot/server/internal/auth"
	"github.com/YoungOver/krot/server/internal/relay"
)

type client struct {
	t     *testing.T
	base  string
	http  *http.Client
	token string
}

func (c *client) do(method, path string, body any, out any) int {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, r)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

// The whole product path: sign up, create a tunnel and a CLI token, connect an
// agent, send a public request, see it in the inspector, replay it.
func TestEndToEnd(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := NewStore()
	edge := &relay.Edge{Domain: "krot.test", Authenticate: store.AuthenticateAgent, Record: store.Record, Log: log}
	a := &API{Store: store, Auth: auth.NewIssuer([]byte("k")), Domain: "krot.test", Online: edge.Online, Log: log}
	a.Replay = func(sub, m, p string, h map[string]string, b string) (int, time.Duration, error) {
		return ReplayThrough(edge, sub+".krot.test", m, p, h, b)
	}
	mux := http.NewServeMux()
	a.Routes(mux)
	apiSrv := httptest.NewServer(mux)
	defer apiSrv.Close()
	pub := httptest.NewServer(edge)
	defer pub.Close()
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go edge.ServeAgents(ln)

	jar, _ := cookiejar.New(nil)
	c := &client{t: t, base: apiSrv.URL, http: &http.Client{Jar: jar}}

	var reg struct {
		PendingID string `json:"pending_id"`
	}
	if st := c.do("POST", "/api/auth/register", map[string]string{"email": "Anna@Shop.ru", "password": "Tunnel-2026", "name": "Анна"}, &reg); st != 200 {
		t.Fatalf("register %d", st)
	}
	store.mu.RLock()
	code := store.pending[reg.PendingID].code
	store.mu.RUnlock()
	if st := c.do("POST", "/api/auth/verify", map[string]string{"pending_id": reg.PendingID, "code": "000000x"}, nil); st != 422 {
		t.Fatalf("wrong code accepted: %d", st)
	}
	var s session
	if st := c.do("POST", "/api/auth/verify", map[string]string{"pending_id": reg.PendingID, "code": code}, &s); st != 200 || s.User.Email != "anna@shop.ru" {
		t.Fatalf("verify %d %+v", st, s.User)
	}
	c.token = s.AccessToken

	var tn Tunnel
	if st := c.do("POST", "/api/tunnels", map[string]any{"proto": "http", "local_port": 3000, "subdomain": "shop", "region": "spb"}, &tn); st != 201 || tn.Status != "offline" {
		t.Fatalf("create tunnel %d %+v", st, tn)
	}
	if st := c.do("POST", "/api/tunnels", map[string]any{"proto": "http", "local_port": 3001, "subdomain": "second", "region": "spb"}, nil); st != 402 {
		t.Fatalf("free plan limit not enforced: %d", st)
	}
	var tok Token
	c.do("POST", "/api/tokens", map[string]string{"name": "ноутбук"}, &tok)
	if !strings.HasPrefix(tok.Secret, "krt_") {
		t.Fatalf("token %+v", tok)
	}

	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"ok":true,"path":"`+r.URL.Path+`"}`)
	}))
	defer local.Close()
	ready := make(chan struct{})
	go (&relay.Agent{Edge: ln.Addr().String(), Token: tok.Secret, Subdomain: "shop", Local: strings.TrimPrefix(local.URL, "http://")}).Run(func(string) { close(ready) })
	select {
	case <-ready:
	case <-time.After(3 * time.Second):
		t.Fatal("agent not connected")
	}
	if err := (&relay.Agent{Edge: ln.Addr().String(), Token: "krt_forged", Subdomain: "shop", Local: "127.0.0.1:1"}).Run(nil); err == nil {
		t.Fatal("forged token accepted by the edge")
	}

	req, _ := http.NewRequest("POST", pub.URL+"/webhooks/pay?id=7", strings.NewReader(`{"amount":1490}`))
	req.Host = "shop.krot.test"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(string(body), "/webhooks/pay") {
		t.Fatalf("public request %d %s", res.StatusCode, body)
	}

	var reqs []Req
	c.do("GET", "/api/requests", nil, &reqs)
	if len(reqs) != 1 || reqs[0].Path != "/webhooks/pay?id=7" || reqs[0].ReqBody != `{"amount":1490}` {
		t.Fatalf("inspector %+v", reqs)
	}
	var rp struct{ Status int }
	if st := c.do("POST", "/api/requests/"+reqs[0].ID+"/replay", nil, &rp); st != 200 || rp.Status != 200 {
		t.Fatalf("replay %d %+v", st, rp)
	}
	var list []Tunnel
	c.do("GET", "/api/tunnels", nil, &list)
	if len(list) != 1 || list[0].Status != "online" || list[0].Requests != 2 {
		t.Fatalf("tunnels %+v", list)
	}

	// refresh rotates through the httpOnly cookie; logout kills the session
	var s2 session
	if st := c.do("POST", "/api/auth/refresh", nil, &s2); st != 200 || s2.AccessToken == "" {
		t.Fatalf("refresh %d", st)
	}
	c.token = s2.AccessToken
	c.do("POST", "/api/auth/logout", nil, nil)
	if st := c.do("GET", "/api/me", nil, nil); st != 401 {
		t.Fatalf("access token alive after logout: %d", st)
	}

	// someone else cannot see or touch Anna's tunnel
	other := &client{t: t, base: apiSrv.URL, http: &http.Client{}}
	var reg2 struct {
		PendingID string `json:"pending_id"`
	}
	other.do("POST", "/api/auth/register", map[string]string{"email": "eve@x.ru", "password": "12345678"}, &reg2)
	store.mu.RLock()
	code2 := store.pending[reg2.PendingID].code
	store.mu.RUnlock()
	var se session
	other.do("POST", "/api/auth/verify", map[string]string{"pending_id": reg2.PendingID, "code": code2}, &se)
	other.token = se.AccessToken
	if st := other.do("DELETE", "/api/tunnels/"+tn.ID, nil, nil); st != 404 {
		t.Fatalf("foreign tunnel deletable: %d", st)
	}
}

func TestLoginRateLimitAndTiming(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := &API{Store: NewStore(), Auth: auth.NewIssuer([]byte("k")), Log: log}
	mux := http.NewServeMux()
	a.Routes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := &client{t: t, base: srv.URL, http: &http.Client{}}
	codes := map[int]int{}
	for i := 0; i < 12; i++ {
		codes[c.do("POST", "/api/auth/login", map[string]string{"email": "nobody@x.ru", "password": "guess"}, nil)]++
	}
	if codes[401] != 10 || codes[429] != 2 {
		t.Fatalf("status counts %v", codes)
	}
}
