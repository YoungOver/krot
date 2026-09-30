package relay

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func startEdge(t *testing.T, e *Edge) (agentAddr string, public *httptest.Server) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go e.ServeAgents(ln)
	public = httptest.NewServer(e)
	t.Cleanup(public.Close)
	return ln.Addr().String(), public
}

func connect(t *testing.T, a *Agent) {
	t.Helper()
	ready := make(chan string, 1)
	errc := make(chan error, 1)
	go func() { errc <- a.Run(func(u string) { ready <- u }) }()
	select {
	case <-ready:
	case err := <-errc:
		t.Fatalf("agent: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("agent did not connect")
	}
}

func get(t *testing.T, public, host, path string, body string) *http.Response {
	t.Helper()
	method := http.MethodGet
	if body != "" {
		method = http.MethodPost
	}
	req, _ := http.NewRequest(method, public+path, strings.NewReader(body))
	req.Host = host
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestRequestsReachLocalServerAndAreRecorded(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.Header().Set("X-Seen-Path", r.URL.Path)
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, "echo:%s:%s", r.Method, b)
	}))
	defer local.Close()

	var mu sync.Mutex
	var got []Exchange
	e := &Edge{Domain: "krot.test", Authenticate: func(tok, sub string) (string, error) { return "u1", nil }, Record: func(x Exchange) {
		mu.Lock()
		got = append(got, x)
		mu.Unlock()
	}}
	agentAddr, public := startEdge(t, e)
	connect(t, &Agent{Edge: agentAddr, Token: "t", Subdomain: "shop", Local: strings.TrimPrefix(local.URL, "http://")})

	res := get(t, public.URL, "shop.krot.test", "/api/orders?x=1", `{"sku":"TEA"}`)
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusCreated || string(b) != `echo:POST:{"sku":"TEA"}` || res.Header.Get("X-Seen-Path") != "/api/orders" {
		t.Fatalf("status %d body %q", res.StatusCode, b)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0].Path != "/api/orders?x=1" || got[0].Status != 201 || string(got[0].ReqBody) != `{"sku":"TEA"}` {
		t.Fatalf("recorded %+v", got)
	}
}

func TestConcurrentStreamsShareOneConnection(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(20 * time.Millisecond)
		io.WriteString(w, r.URL.Query().Get("i"))
	}))
	defer local.Close()
	e := &Edge{Domain: "krot.test", Authenticate: func(string, string) (string, error) { return "u", nil }}
	agentAddr, public := startEdge(t, e)
	connect(t, &Agent{Edge: agentAddr, Subdomain: "api", Local: strings.TrimPrefix(local.URL, "http://")})

	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res := get(t, public.URL, "api.krot.test", fmt.Sprintf("/?i=%d", i), "")
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if string(b) != fmt.Sprint(i) {
				t.Errorf("stream %d got %q", i, b)
			}
		}(i)
	}
	wg.Wait()
}

func TestLargeBodyStreamsThrough(t *testing.T) {
	payload := strings.Repeat("0123456789", 300_000) // 3 MB, many frames
	// read the whole body before answering: Go's HTTP/1 server is not full-duplex by default
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.Write(b)
	}))
	defer local.Close()
	e := &Edge{Domain: "krot.test", Authenticate: func(string, string) (string, error) { return "u", nil }}
	agentAddr, public := startEdge(t, e)
	connect(t, &Agent{Edge: agentAddr, Subdomain: "big", Local: strings.TrimPrefix(local.URL, "http://")})
	res := get(t, public.URL, "big.krot.test", "/", payload)
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(b) != payload {
		t.Fatalf("got %d bytes, want %d", len(b), len(payload))
	}
}

func TestRejectedTokenAndOfflineTunnel(t *testing.T) {
	e := &Edge{Domain: "krot.test", Authenticate: func(tok, _ string) (string, error) {
		if tok != "good" {
			return "", errors.New("invalid token")
		}
		return "u", nil
	}}
	agentAddr, public := startEdge(t, e)
	err := (&Agent{Edge: agentAddr, Token: "bad", Subdomain: "x", Local: "127.0.0.1:1"}).Run(nil)
	if !errors.Is(err, ErrRejected) || !strings.Contains(err.Error(), "invalid token") {
		t.Fatalf("err = %v", err)
	}
	res := get(t, public.URL, "nobody.krot.test", "/", "")
	res.Body.Close()
	if res.StatusCode != http.StatusBadGateway {
		t.Fatalf("offline tunnel status %d", res.StatusCode)
	}
}

func TestLocalServerDownGives502(t *testing.T) {
	e := &Edge{Domain: "krot.test", Authenticate: func(string, string) (string, error) { return "u", nil }}
	agentAddr, public := startEdge(t, e)
	connect(t, &Agent{Edge: agentAddr, Subdomain: "down", Local: "127.0.0.1:1"})
	res := get(t, public.URL, "down.krot.test", "/", "")
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusBadGateway || !strings.Contains(string(b), "недоступен") {
		t.Fatalf("status %d body %q", res.StatusCode, b)
	}
}
