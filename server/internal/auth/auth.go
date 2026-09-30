// Package auth issues short-lived access tokens (HS256 JWT) and rotating refresh
// tokens with reuse detection: presenting an already rotated refresh token
// revokes the whole session family, because it means the token was stolen.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalid = errors.New("auth: invalid token")
	ErrExpired = errors.New("auth: token expired")
	ErrReused  = errors.New("auth: refresh token reused, session revoked")
)

const (
	AccessTTL  = 15 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
)

type Claims struct {
	Sub string `json:"sub"`
	Sid string `json:"sid"`
	Exp int64  `json:"exp"`
	Iat int64  `json:"iat"`
}

var b64 = base64.RawURLEncoding

// Issuer signs access tokens and tracks refresh token families in memory.
type Issuer struct {
	key []byte
	now func() time.Time

	mu       sync.Mutex
	families map[string]*family // session id -> family
	byHash   map[string]string  // sha256(refresh) -> session id
}

type family struct {
	user    string
	current string // hash of the only valid refresh token
	used    map[string]bool
	expires time.Time
	agent   string
	ip      string
	seen    time.Time
}

func NewIssuer(key []byte) *Issuer {
	return &Issuer{key: key, now: time.Now, families: map[string]*family{}, byHash: map[string]string{}}
}

func (i *Issuer) sign(c Claims) string {
	head := b64.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body, _ := json.Marshal(c)
	msg := head + "." + b64.EncodeToString(body)
	m := hmac.New(sha256.New, i.key)
	m.Write([]byte(msg))
	return msg + "." + b64.EncodeToString(m.Sum(nil))
}

// Verify checks signature and expiry of an access token.
func (i *Issuer) Verify(tok string) (Claims, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalid
	}
	m := hmac.New(sha256.New, i.key)
	m.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := b64.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, m.Sum(nil)) {
		return Claims{}, ErrInvalid
	}
	raw, err := b64.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalid
	}
	var c Claims
	if json.Unmarshal(raw, &c) != nil {
		return Claims{}, ErrInvalid
	}
	if i.now().Unix() >= c.Exp {
		return Claims{}, ErrExpired
	}
	i.mu.Lock()
	_, alive := i.families[c.Sid]
	i.mu.Unlock()
	if !alive { // logout and revocation take effect immediately, not after 15 minutes
		return Claims{}, ErrInvalid
	}
	return c, nil
}

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return b64.EncodeToString(b)
}

func hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// Pair is what a successful login or refresh returns.
type Pair struct {
	Access  string
	Refresh string
	Session string
}

func (i *Issuer) access(user, sid string) string {
	now := i.now()
	return i.sign(Claims{Sub: user, Sid: sid, Iat: now.Unix(), Exp: now.Add(AccessTTL).Unix()})
}

// Start opens a new session family after a successful login.
func (i *Issuer) Start(user, agent, ip string) Pair {
	sid := randomToken()[:16]
	rt := randomToken()
	i.mu.Lock()
	i.families[sid] = &family{user: user, current: hash(rt), used: map[string]bool{}, expires: i.now().Add(RefreshTTL), agent: agent, ip: ip, seen: i.now()}
	i.byHash[hash(rt)] = sid
	i.mu.Unlock()
	return Pair{Access: i.access(user, sid), Refresh: rt, Session: sid}
}

// Rotate exchanges a refresh token for a new pair. The old token becomes used;
// seeing a used token again revokes the family.
func (i *Issuer) Rotate(rt, ip string) (Pair, string, error) {
	h := hash(rt)
	i.mu.Lock()
	defer i.mu.Unlock()
	sid, ok := i.byHash[h]
	if !ok {
		return Pair{}, "", ErrInvalid
	}
	f, ok := i.families[sid]
	if !ok {
		return Pair{}, "", ErrInvalid
	}
	if f.used[h] {
		i.revokeLocked(sid)
		return Pair{}, "", ErrReused
	}
	if f.current != h {
		return Pair{}, "", ErrInvalid
	}
	if i.now().After(f.expires) {
		i.revokeLocked(sid)
		return Pair{}, "", ErrExpired
	}
	f.used[h] = true
	next := randomToken()
	f.current = hash(next)
	f.seen = i.now()
	f.ip = ip
	i.byHash[f.current] = sid
	return Pair{Access: i.access(f.user, sid), Refresh: next, Session: sid}, f.user, nil
}

func (i *Issuer) revokeLocked(sid string) {
	f := i.families[sid]
	if f == nil {
		return
	}
	delete(i.byHash, f.current)
	for h := range f.used {
		delete(i.byHash, h)
	}
	delete(i.families, sid)
}

// Revoke ends a session, e.g. on logout or from the sessions list.
func (i *Issuer) Revoke(user, sid string) bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	if f := i.families[sid]; f == nil || f.user != user {
		return false
	}
	i.revokeLocked(sid)
	return true
}

type SessionInfo struct {
	ID       string
	Agent    string
	IP       string
	LastSeen time.Time
}

func (i *Issuer) Sessions(user string) []SessionInfo {
	i.mu.Lock()
	defer i.mu.Unlock()
	var out []SessionInfo
	for id, f := range i.families {
		if f.user == user {
			out = append(out, SessionInfo{id, f.agent, f.ip, f.seen})
		}
	}
	return out
}
