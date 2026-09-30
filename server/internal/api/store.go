package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"github.com/YoungOver/krot/server/internal/relay"
)

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Plan      string    `json:"plan"`
	TwoFA     bool      `json:"twofa"`
	CreatedAt time.Time `json:"created_at"`
	hash      []byte
}

type Tunnel struct {
	ID        string    `json:"id"`
	Proto     string    `json:"proto"`
	LocalPort int       `json:"local_port"`
	Subdomain string    `json:"subdomain"`
	URL       string    `json:"url"`
	Region    string    `json:"region"`
	Status    string    `json:"status"`
	Requests  int       `json:"requests_24h"`
	CreatedAt time.Time `json:"created_at"`
	owner     string
	paused    bool
}

type Token struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Prefix    string     `json:"prefix"`
	LastUsed  *time.Time `json:"last_used"`
	CreatedAt time.Time  `json:"created_at"`
	Secret    string     `json:"secret,omitempty"`
	owner     string
	hash      string
}

type Req struct {
	ID         string            `json:"id"`
	TunnelID   string            `json:"tunnel_id"`
	Method     string            `json:"method"`
	Path       string            `json:"path"`
	Status     int               `json:"status"`
	DurationMs int64             `json:"duration_ms"`
	Size       int64             `json:"size"`
	IP         string            `json:"ip"`
	At         time.Time         `json:"at"`
	ReqHeaders map[string]string `json:"req_headers"`
	ResHeaders map[string]string `json:"res_headers"`
	ReqBody    string            `json:"req_body"`
	ResBody    string            `json:"res_body"`
	owner      string
}

type pending struct {
	email, name string
	hash        []byte
	code        string
	expires     time.Time
	attempts    int
}

// Store is the in-memory state of the service. A production build would put
// users, tunnels and tokens in PostgreSQL and requests in a capped table; the
// interface of the handlers would not change.
type Store struct {
	mu       sync.RWMutex
	users    map[string]*User // id
	byEmail  map[string]string
	pending  map[string]*pending
	tunnels  map[string]*Tunnel // id
	bySub    map[string]string
	tokens   map[string]*Token
	byTokHas map[string]string
	reqs     []Req // ring buffer of recent exchanges, newest last
	domains  map[string]*Domain
}

const reqKeep = 5000

func NewStore() *Store {
	return &Store{users: map[string]*User{}, byEmail: map[string]string{}, pending: map[string]*pending{}, tunnels: map[string]*Tunnel{}, bySub: map[string]string{}, tokens: map[string]*Token{}, byTokHas: map[string]string{}, domains: map[string]*Domain{}}
}

func newID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func sha(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// Record stores one exchange from the relay, attributed to the tunnel owner.
func (s *Store) Record(x relay.Exchange) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tid, ok := s.bySub[x.Subdomain]
	if !ok {
		return
	}
	t := s.tunnels[tid]
	flat := func(h map[string][]string) map[string]string {
		out := map[string]string{}
		for k, v := range h {
			out[strings.ToLower(k)] = strings.Join(v, ", ")
		}
		return out
	}
	s.reqs = append(s.reqs, Req{
		ID: newID("req"), TunnelID: tid, Method: x.Method, Path: x.Path, Status: x.Status, DurationMs: x.Duration.Milliseconds(),
		Size: x.Size, IP: x.RemoteIP, At: x.At, ReqHeaders: flat(x.ReqHeader), ResHeaders: flat(x.ResHeader),
		ReqBody: string(x.ReqBody), ResBody: string(x.ResBody), owner: t.owner,
	})
	if len(s.reqs) > reqKeep {
		s.reqs = append([]Req(nil), s.reqs[len(s.reqs)-reqKeep:]...)
	}
}

// AuthenticateAgent decides whether a CLI token may serve a subdomain.
func (s *Store) AuthenticateAgent(secret, sub string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tid, ok := s.byTokHas[sha(secret)]
	if !ok {
		return "", errString("неизвестный токен, выполните krot login")
	}
	tok := s.tokens[tid]
	t := s.tunnels[s.bySub[sub]]
	if t == nil || t.owner != tok.owner {
		return "", errString("туннель " + sub + " не найден в вашем аккаунте")
	}
	if t.paused {
		return "", errString("туннель " + sub + " выключен в кабинете")
	}
	now := time.Now()
	tok.LastUsed = &now
	return tok.owner, nil
}

type errString string

func (e errString) Error() string { return string(e) }
