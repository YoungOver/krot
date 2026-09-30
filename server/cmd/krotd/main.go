// krotd runs the dashboard API, the public tunnel edge and the agent listener.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/YoungOver/krot/server/internal/api"
	"github.com/YoungOver/krot/server/internal/auth"
	"github.com/YoungOver/krot/server/internal/relay"
)

func main() {
	apiAddr := flag.String("api", ":8081", "dashboard API address")
	edgeAddr := flag.String("edge", ":8080", "public HTTP address for tunnels")
	agentAddr := flag.String("agents", ":7000", "address agents connect to")
	domain := flag.String("domain", "krot.localhost:8080", "public tunnel domain (subdomains resolve to the edge)")
	secret := flag.String("jwt-secret", os.Getenv("KROT_JWT_SECRET"), "HMAC key for access tokens, random if empty")
	secure := flag.Bool("secure-cookie", false, "mark the refresh cookie Secure (enable behind HTTPS)")
	flag.Parse()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	key := []byte(*secret)
	if len(key) == 0 {
		key = make([]byte, 32)
		rand.Read(key)
		log.Warn("KROT_JWT_SECRET not set: sessions will not survive a restart")
	}

	store := api.NewStore()
	edge := &relay.Edge{Domain: *domain, Authenticate: store.AuthenticateAgent, Record: store.Record, Log: log}
	a := &api.API{Store: store, Auth: auth.NewIssuer(key), Domain: *domain, Online: edge.Online, Log: log, Secure: *secure, Replay: replayVia(edge, *domain)}

	mux := http.NewServeMux()
	a.Routes(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := net.Listen("tcp", *agentAddr)
	if err != nil {
		log.Error("agents listener", "err", err)
		os.Exit(1)
	}
	go edge.ServeAgents(ln)

	servers := []*http.Server{
		{Addr: *apiAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second},
		{Addr: *edgeAddr, Handler: edge, ReadHeaderTimeout: 10 * time.Second},
	}
	for _, s := range servers {
		go func(s *http.Server) {
			if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("http", "addr", s.Addr, "err", err)
				stop()
			}
		}(s)
	}
	log.Info("krotd started", "api", *apiAddr, "edge", *edgeAddr, "agents", *agentAddr, "domain", *domain)
	<-ctx.Done()
	ln.Close()
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, s := range servers {
		s.Shutdown(sctx)
	}
}

// replayVia sends a stored request through the edge handler in-process, so a
// replay takes exactly the path a real request takes.
func replayVia(edge http.Handler, domain string) func(sub, method, path string, h map[string]string, body string) (int, time.Duration, error) {
	return func(sub, method, path string, h map[string]string, body string) (int, time.Duration, error) {
		return api.ReplayThrough(edge, sub+"."+domain, method, path, h, body)
	}
}
