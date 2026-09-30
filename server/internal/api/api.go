// Package api is the HTTP API used by the web dashboard.
package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/YoungOver/krot/server/internal/auth"
	"github.com/YoungOver/krot/server/internal/ratelimit"
)

type API struct {
	Store  *Store
	Auth   *auth.Issuer
	Domain string // public tunnel domain, e.g. krot.localhost:8080
	Online func(sub string) bool
	Log    *slog.Logger
	Secure bool // Secure flag on the refresh cookie (true behind HTTPS)
	// Replay re-sends a recorded request through the tunnel and returns the new status.
	Replay func(sub, method, path string, headers map[string]string, body string) (int, time.Duration, error)
	// LookupCNAME is net.LookupCNAME, replaceable in tests.
	LookupCNAME func(host string) (string, error)
	limiter     *ratelimit.Limiter
}

type ctxUser struct{}

var (
	emailRe  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	subRe    = regexp.MustCompile(`^[a-z0-9-]{3,32}$`)
	reserved = map[string]bool{"www": true, "api": true, "app": true, "admin": true, "mail": true, "krot": true}
	limits   = map[string]int{"free": 1, "pro": 10, "team": 50}
)

func (a *API) Routes(mux *http.ServeMux) {
	a.limiter = ratelimit.New(10, time.Minute) // login and verify: 10 attempts per minute per IP
	mux.HandleFunc("POST /api/auth/register", a.limited(a.register))
	mux.HandleFunc("POST /api/auth/verify", a.limited(a.verify))
	mux.HandleFunc("POST /api/auth/login", a.limited(a.login))
	mux.HandleFunc("POST /api/auth/refresh", a.refresh)
	mux.HandleFunc("POST /api/auth/logout", a.logout)

	mux.HandleFunc("GET /api/me", a.authed(a.me))
	mux.HandleFunc("PATCH /api/me", a.authed(a.patchMe))
	mux.HandleFunc("GET /api/tunnels", a.authed(a.listTunnels))
	mux.HandleFunc("POST /api/tunnels", a.authed(a.createTunnel))
	mux.HandleFunc("PATCH /api/tunnels/{id}", a.authed(a.pauseTunnel))
	mux.HandleFunc("DELETE /api/tunnels/{id}", a.authed(a.deleteTunnel))
	mux.HandleFunc("GET /api/requests", a.authed(a.listRequests))
	mux.HandleFunc("GET /api/stats", a.authed(a.stats))
	mux.HandleFunc("GET /api/tokens", a.authed(a.listTokens))
	mux.HandleFunc("POST /api/tokens", a.authed(a.createToken))
	mux.HandleFunc("DELETE /api/tokens/{id}", a.authed(a.deleteToken))
	mux.HandleFunc("GET /api/sessions", a.authed(a.sessions))
	mux.HandleFunc("DELETE /api/sessions/{id}", a.authed(a.revokeSession))
	mux.HandleFunc("POST /api/billing/plan", a.authed(a.changePlan))
	mux.HandleFunc("GET /api/billing", a.authed(a.billing))
	mux.HandleFunc("GET /api/domains", a.authed(a.listDomains))
	mux.HandleFunc("POST /api/domains", a.authed(a.addDomain))
	mux.HandleFunc("POST /api/domains/{id}/check", a.authed(a.checkDomain))
	mux.HandleFunc("POST /api/requests/{id}/replay", a.authed(a.replay))
}

// ---------- helpers ----------

type apiErr struct {
	status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func fail(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, apiErr{Code: code, Message: msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func decode(r *http.Request, v any) bool {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16)).Decode(v) == nil
}

func ip(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func (a *API) limited(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.limiter.Allow(ip(r)) {
			fail(w, http.StatusTooManyRequests, "rate_limited", "Слишком много попыток, подождите минуту")
			return
		}
		h(w, r)
	}
}

func (a *API) authed(h func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := a.Auth.Verify(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if err != nil {
			fail(w, http.StatusUnauthorized, "unauthorized", "Сессия истекла")
			return
		}
		a.Store.mu.RLock()
		u := a.Store.users[c.Sub]
		a.Store.mu.RUnlock()
		if u == nil {
			fail(w, http.StatusUnauthorized, "unauthorized", "Пользователь не найден")
			return
		}
		h(w, r, u)
	}
}

const refreshCookie = "krot_rt"

func (a *API) setRefresh(w http.ResponseWriter, token string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{Name: refreshCookie, Value: token, Path: "/api/auth", HttpOnly: true, Secure: a.Secure, SameSite: http.SameSiteStrictMode, MaxAge: int(ttl.Seconds())})
}

type session struct {
	AccessToken string `json:"access_token"`
	User        *User  `json:"user"`
}

func (a *API) startSession(w http.ResponseWriter, r *http.Request, u *User) {
	p := a.Auth.Start(u.ID, r.UserAgent(), ip(r))
	a.setRefresh(w, p.Refresh, auth.RefreshTTL)
	writeJSON(w, http.StatusOK, session{p.Access, u})
}

// ---------- auth ----------

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var b struct{ Email, Password, Name string }
	if !decode(r, &b) {
		fail(w, 400, "bad_json", "Некорректный запрос")
		return
	}
	email := strings.ToLower(strings.TrimSpace(b.Email))
	switch {
	case !emailRe.MatchString(email):
		fail(w, 422, "email", "Проверьте адрес почты")
		return
	case len(b.Password) < 8:
		fail(w, 422, "password", "Пароль должен быть не короче 8 символов")
		return
	}
	a.Store.mu.RLock()
	_, exists := a.Store.byEmail[email]
	a.Store.mu.RUnlock()
	if exists {
		fail(w, 409, "exists", "Аккаунт с этой почтой уже есть, войдите")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(b.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "internal", "Не удалось создать аккаунт")
		return
	}
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
	code := fmt.Sprintf("%06d", n.Int64())
	id := newID("pnd")
	name := strings.TrimSpace(b.Name)
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	a.Store.mu.Lock()
	a.Store.pending[id] = &pending{email: email, name: name, hash: hash, code: code, expires: time.Now().Add(15 * time.Minute)}
	a.Store.mu.Unlock()
	// a real deployment sends this through an email provider; in development it goes to the log
	a.Log.Info("verification code", "email", email, "code", code)
	writeJSON(w, 200, map[string]string{"pending_id": id, "email": email})
}

func (a *API) verify(w http.ResponseWriter, r *http.Request) {
	var b struct {
		PendingID string `json:"pending_id"`
		Code      string `json:"code"`
	}
	if !decode(r, &b) {
		fail(w, 400, "bad_json", "Некорректный запрос")
		return
	}
	a.Store.mu.Lock()
	p := a.Store.pending[b.PendingID]
	if p == nil || time.Now().After(p.expires) {
		a.Store.mu.Unlock()
		fail(w, 410, "expired", "Код устарел, зарегистрируйтесь заново")
		return
	}
	if b.Code != p.code {
		p.attempts++
		if p.attempts >= 5 {
			delete(a.Store.pending, b.PendingID)
		}
		a.Store.mu.Unlock()
		fail(w, 422, "code", "Неверный код")
		return
	}
	delete(a.Store.pending, b.PendingID)
	if _, taken := a.Store.byEmail[p.email]; taken {
		a.Store.mu.Unlock()
		fail(w, 409, "exists", "Аккаунт с этой почтой уже есть, войдите")
		return
	}
	u := &User{ID: newID("usr"), Email: p.email, Name: p.name, Plan: "free", CreatedAt: time.Now(), hash: p.hash}
	a.Store.users[u.ID] = u
	a.Store.byEmail[u.Email] = u.ID
	a.Store.mu.Unlock()
	a.startSession(w, r, u)
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var b struct{ Email, Password string }
	if !decode(r, &b) {
		fail(w, 400, "bad_json", "Некорректный запрос")
		return
	}
	a.Store.mu.RLock()
	u := a.Store.users[a.Store.byEmail[strings.ToLower(strings.TrimSpace(b.Email))]]
	a.Store.mu.RUnlock()
	// compare against a dummy hash for unknown emails so timing does not reveal accounts
	hash := dummyHash
	if u != nil {
		hash = u.hash
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(b.Password)) != nil || u == nil {
		fail(w, 401, "credentials", "Неверная почта или пароль")
		return
	}
	a.startSession(w, r, u)
}

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("krot-dummy-password"), bcrypt.DefaultCost)

func (a *API) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		fail(w, 401, "no_session", "Нет активной сессии")
		return
	}
	p, uid, err := a.Auth.Rotate(c.Value, ip(r))
	if err != nil {
		a.setRefresh(w, "", -time.Second)
		if err == auth.ErrReused {
			a.Log.Warn("refresh token reuse, session revoked", "ip", ip(r))
		}
		fail(w, 401, "no_session", "Сессия завершена, войдите снова")
		return
	}
	a.Store.mu.RLock()
	u := a.Store.users[uid]
	a.Store.mu.RUnlock()
	a.setRefresh(w, p.Refresh, auth.RefreshTTL)
	writeJSON(w, 200, session{p.Access, u})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := a.Auth.Verify(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")); err == nil {
		a.Auth.Revoke(c.Sub, c.Sid)
	}
	a.setRefresh(w, "", -time.Second)
	w.WriteHeader(http.StatusNoContent)
}

// ---------- account ----------

func (a *API) me(w http.ResponseWriter, _ *http.Request, u *User) { writeJSON(w, 200, u) }

func (a *API) patchMe(w http.ResponseWriter, r *http.Request, u *User) {
	var b struct {
		Name  *string `json:"name"`
		TwoFA *bool   `json:"twofa"`
	}
	if !decode(r, &b) {
		fail(w, 400, "bad_json", "Некорректный запрос")
		return
	}
	a.Store.mu.Lock()
	if b.Name != nil && strings.TrimSpace(*b.Name) != "" {
		u.Name = strings.TrimSpace(*b.Name)
	}
	if b.TwoFA != nil {
		u.TwoFA = *b.TwoFA
	}
	a.Store.mu.Unlock()
	writeJSON(w, 200, u)
}

func (a *API) sessions(w http.ResponseWriter, r *http.Request, u *User) {
	c, _ := a.Auth.Verify(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	type out struct {
		ID       string    `json:"id"`
		Agent    string    `json:"agent"`
		IP       string    `json:"ip"`
		City     string    `json:"city"`
		LastSeen time.Time `json:"last_seen"`
		Current  bool      `json:"current"`
	}
	var res []out
	for _, s := range a.Auth.Sessions(u.ID) {
		res = append(res, out{s.ID, s.Agent, s.IP, "", s.LastSeen, s.ID == c.Sid})
	}
	writeJSON(w, 200, res)
}

func (a *API) revokeSession(w http.ResponseWriter, r *http.Request, u *User) {
	if !a.Auth.Revoke(u.ID, r.PathValue("id")) {
		fail(w, 404, "not_found", "Сессия не найдена")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) changePlan(w http.ResponseWriter, r *http.Request, u *User) {
	var b struct{ Plan string }
	if !decode(r, &b) || limits[b.Plan] == 0 {
		fail(w, 422, "plan", "Неизвестный тариф")
		return
	}
	a.Store.mu.Lock()
	u.Plan = b.Plan
	a.Store.mu.Unlock()
	writeJSON(w, 200, map[string]any{"plan": u.Plan})
}

// ---------- tunnels ----------

func (a *API) view(t *Tunnel) Tunnel {
	v := *t
	switch {
	case t.paused:
		v.Status = "paused"
	case a.Online != nil && a.Online(t.Subdomain):
		v.Status = "online"
	default:
		v.Status = "offline"
	}
	return v
}

func (a *API) listTunnels(w http.ResponseWriter, _ *http.Request, u *User) {
	a.Store.mu.RLock()
	var out []Tunnel
	for _, t := range a.Store.tunnels {
		if t.owner == u.ID {
			v := a.view(t)
			for _, rq := range a.Store.reqs {
				if rq.TunnelID == t.ID && time.Since(rq.At) < 24*time.Hour {
					v.Requests++
				}
			}
			out = append(out, v)
		}
	}
	a.Store.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	writeJSON(w, 200, nonNil(out))
}

func (a *API) createTunnel(w http.ResponseWriter, r *http.Request, u *User) {
	var b struct {
		Proto     string `json:"proto"`
		LocalPort int    `json:"local_port"`
		Subdomain string `json:"subdomain"`
		Region    string `json:"region"`
	}
	if !decode(r, &b) {
		fail(w, 400, "bad_json", "Некорректный запрос")
		return
	}
	sub := strings.ToLower(strings.TrimSpace(b.Subdomain))
	switch {
	case !subRe.MatchString(sub):
		fail(w, 422, "subdomain", "Поддомен: латиница, цифры и дефис, от 3 до 32 символов")
		return
	case b.LocalPort < 1 || b.LocalPort > 65535:
		fail(w, 422, "port", "Порт от 1 до 65535")
		return
	case b.Proto != "http" && b.Proto != "tcp":
		fail(w, 422, "proto", "Протокол http или tcp")
		return
	}
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	n := 0
	for _, t := range a.Store.tunnels {
		if t.owner == u.ID {
			n++
		}
	}
	if n >= limits[u.Plan] {
		fail(w, 402, "limit", fmt.Sprintf("На вашем тарифе доступно туннелей: %d. Смените тариф в разделе «Оплата»", limits[u.Plan]))
		return
	}
	if _, taken := a.Store.bySub[sub]; taken || reserved[sub] {
		fail(w, 409, "taken", "Адрес "+sub+" уже занят")
		return
	}
	t := &Tunnel{ID: newID("tn"), Proto: b.Proto, LocalPort: b.LocalPort, Subdomain: sub, URL: "http://" + sub + "." + a.Domain, Region: b.Region, CreatedAt: time.Now(), owner: u.ID}
	a.Store.tunnels[t.ID] = t
	a.Store.bySub[sub] = t.ID
	writeJSON(w, 201, a.view(t))
}

func (a *API) ownTunnel(w http.ResponseWriter, r *http.Request, u *User) *Tunnel {
	t := a.Store.tunnels[r.PathValue("id")]
	if t == nil || t.owner != u.ID {
		fail(w, 404, "not_found", "Туннель не найден")
		return nil
	}
	return t
}

func (a *API) pauseTunnel(w http.ResponseWriter, r *http.Request, u *User) {
	var b struct{ Paused bool }
	if !decode(r, &b) {
		fail(w, 400, "bad_json", "Некорректный запрос")
		return
	}
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	if t := a.ownTunnel(w, r, u); t != nil {
		t.paused = b.Paused
		writeJSON(w, 200, a.view(t))
	}
}

func (a *API) deleteTunnel(w http.ResponseWriter, r *http.Request, u *User) {
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	if t := a.ownTunnel(w, r, u); t != nil {
		delete(a.Store.tunnels, t.ID)
		delete(a.Store.bySub, t.Subdomain)
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------- inspector and stats ----------

func (a *API) listRequests(w http.ResponseWriter, r *http.Request, u *User) {
	tid := r.URL.Query().Get("tunnel")
	a.Store.mu.RLock()
	var out []Req
	for i := len(a.Store.reqs) - 1; i >= 0 && len(out) < 100; i-- {
		rq := a.Store.reqs[i]
		if rq.owner == u.ID && (tid == "" || rq.TunnelID == tid) {
			out = append(out, rq)
		}
	}
	a.Store.mu.RUnlock()
	writeJSON(w, 200, nonNil(out))
}

func (a *API) stats(w http.ResponseWriter, r *http.Request, u *User) {
	hours := 24
	if r.URL.Query().Get("range") == "7d" {
		hours = 168
	}
	type point struct {
		T        time.Time `json:"t"`
		Requests int       `json:"requests"`
		Errors   int       `json:"errors"`
		P95      int64     `json:"p95"`
	}
	end := time.Now().Truncate(time.Hour)
	pts := make([]point, hours)
	durs := make([][]int64, hours)
	for i := range pts {
		pts[i].T = end.Add(time.Duration(i-hours+1) * time.Hour)
	}
	a.Store.mu.RLock()
	for _, rq := range a.Store.reqs {
		if rq.owner != u.ID {
			continue
		}
		i := hours - 1 - int(end.Sub(rq.At.Truncate(time.Hour))/time.Hour)
		if i < 0 || i >= hours {
			continue
		}
		pts[i].Requests++
		if rq.Status >= 500 {
			pts[i].Errors++
		}
		durs[i] = append(durs[i], rq.DurationMs)
	}
	a.Store.mu.RUnlock()
	for i, d := range durs {
		if len(d) > 0 {
			sort.Slice(d, func(a, b int) bool { return d[a] < d[b] })
			pts[i].P95 = d[(len(d)-1)*95/100]
		}
	}
	writeJSON(w, 200, pts)
}

// ---------- CLI tokens ----------

func (a *API) listTokens(w http.ResponseWriter, _ *http.Request, u *User) {
	a.Store.mu.RLock()
	var out []Token
	for _, t := range a.Store.tokens {
		if t.owner == u.ID {
			out = append(out, *t)
		}
	}
	a.Store.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	writeJSON(w, 200, nonNil(out))
}

func (a *API) createToken(w http.ResponseWriter, r *http.Request, u *User) {
	var b struct{ Name string }
	if !decode(r, &b) || strings.TrimSpace(b.Name) == "" {
		fail(w, 422, "name", "Назовите токен, например «ноутбук» или «CI»")
		return
	}
	raw := make([]byte, 20)
	rand.Read(raw)
	secret := fmt.Sprintf("krt_%x", raw)
	t := &Token{ID: newID("tok"), Name: strings.TrimSpace(b.Name), Prefix: secret[:10], CreatedAt: time.Now(), owner: u.ID, hash: sha(secret)}
	a.Store.mu.Lock()
	a.Store.tokens[t.ID] = t
	a.Store.byTokHas[t.hash] = t.ID
	a.Store.mu.Unlock()
	res := *t
	res.Secret = secret // shown once; only the hash is stored
	writeJSON(w, 201, res)
}

func (a *API) deleteToken(w http.ResponseWriter, r *http.Request, u *User) {
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	t := a.Store.tokens[r.PathValue("id")]
	if t == nil || t.owner != u.ID {
		fail(w, 404, "not_found", "Токен не найден")
		return
	}
	delete(a.Store.tokens, t.ID)
	delete(a.Store.byTokHas, t.hash)
	w.WriteHeader(http.StatusNoContent)
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// ---------- billing, domains, replay ----------

func (a *API) billing(w http.ResponseWriter, _ *http.Request, u *User) {
	a.Store.mu.RLock()
	tunnels, reqs := 0, 0
	for _, t := range a.Store.tunnels {
		if t.owner == u.ID {
			tunnels++
		}
	}
	monthAgo := time.Now().AddDate(0, -1, 0)
	for _, rq := range a.Store.reqs {
		if rq.owner == u.ID && rq.At.After(monthAgo) {
			reqs++
		}
	}
	plan := u.Plan
	a.Store.mu.RUnlock()
	reqLimits := map[string]int{"free": 20_000, "pro": 2_000_000, "team": 20_000_000}
	writeJSON(w, 200, map[string]any{
		"plan":      plan,
		"renews_at": u.CreatedAt.AddDate(0, 1, 0),
		"usage":     map[string]int{"tunnels": tunnels, "tunnels_limit": limits[plan], "requests": reqs, "requests_limit": reqLimits[plan]},
		"invoices":  []any{}, // payments are out of scope for this service
	})
}

type Domain struct {
	ID       string  `json:"id"`
	Host     string  `json:"host"`
	Status   string  `json:"status"`
	CNAME    string  `json:"cname"`
	TunnelID *string `json:"tunnel_id"`
	owner    string
}

var hostRe = regexp.MustCompile(`^([a-z0-9-]+\.)+[a-z]{2,}$`)

func (a *API) listDomains(w http.ResponseWriter, _ *http.Request, u *User) {
	a.Store.mu.RLock()
	var out []Domain
	for _, d := range a.Store.domains {
		if d.owner == u.ID {
			out = append(out, *d)
		}
	}
	a.Store.mu.RUnlock()
	writeJSON(w, 200, nonNil(out))
}

func (a *API) addDomain(w http.ResponseWriter, r *http.Request, u *User) {
	var b struct{ Host string }
	if !decode(r, &b) || !hostRe.MatchString(strings.ToLower(b.Host)) {
		fail(w, 422, "host", "Введите домен целиком, например api.shop.ru")
		return
	}
	host := strings.ToLower(b.Host)
	d := &Domain{ID: newID("dom"), Host: host, Status: "pending", CNAME: "edge." + strings.Split(a.Domain, ":")[0], owner: u.ID}
	a.Store.mu.Lock()
	a.Store.domains[d.ID] = d
	a.Store.mu.Unlock()
	writeJSON(w, 201, d)
}

// checkDomain resolves the customer's CNAME and activates the domain when it
// points at the edge. Certificates would be issued by the edge via ACME here.
func (a *API) checkDomain(w http.ResponseWriter, r *http.Request, u *User) {
	a.Store.mu.RLock()
	d := a.Store.domains[r.PathValue("id")]
	a.Store.mu.RUnlock()
	if d == nil || d.owner != u.ID {
		fail(w, 404, "not_found", "Домен не найден")
		return
	}
	lookup := a.LookupCNAME
	if lookup == nil {
		lookup = net.LookupCNAME
	}
	got, err := lookup(d.Host)
	if err != nil || strings.TrimSuffix(got, ".") != d.CNAME {
		fail(w, 409, "dns", fmt.Sprintf("Запись CNAME для %s пока указывает на %q, ожидается %s. DNS обновляется до 30 минут", d.Host, strings.TrimSuffix(got, "."), d.CNAME))
		return
	}
	a.Store.mu.Lock()
	d.Status = "active"
	a.Store.mu.Unlock()
	writeJSON(w, 200, d)
}

func (a *API) replay(w http.ResponseWriter, r *http.Request, u *User) {
	a.Store.mu.RLock()
	var rq *Req
	for i := range a.Store.reqs {
		if a.Store.reqs[i].ID == r.PathValue("id") && a.Store.reqs[i].owner == u.ID {
			c := a.Store.reqs[i]
			rq = &c
		}
	}
	var sub string
	if rq != nil && a.Store.tunnels[rq.TunnelID] != nil {
		sub = a.Store.tunnels[rq.TunnelID].Subdomain
	}
	a.Store.mu.RUnlock()
	if rq == nil || sub == "" || a.Replay == nil {
		fail(w, 404, "not_found", "Запрос не найден или туннель удалён")
		return
	}
	status, dur, err := a.Replay(sub, rq.Method, rq.Path, rq.ReqHeaders, rq.ReqBody)
	if err != nil {
		fail(w, 502, "replay", "Не удалось повторить: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"status": status, "duration_ms": dur.Milliseconds()})
}
