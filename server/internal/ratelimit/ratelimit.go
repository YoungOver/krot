// Package ratelimit is a fixed-window limiter keyed by client, used on the
// login, registration and code-check endpoints against password guessing.
package ratelimit

import (
	"sync"
	"time"
)

type Limiter struct {
	max    int
	window time.Duration
	now    func() time.Time

	mu     sync.Mutex
	counts map[string]*bucket
}

type bucket struct {
	start time.Time
	n     int
}

func New(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, now: time.Now, counts: map[string]*bucket{}}
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b := l.counts[key]
	if b == nil || now.Sub(b.start) >= l.window {
		if len(l.counts) > 100_000 { // drop stale buckets instead of growing forever
			for k, v := range l.counts {
				if now.Sub(v.start) >= l.window {
					delete(l.counts, k)
				}
			}
		}
		l.counts[key] = &bucket{start: now, n: 1}
		return true
	}
	b.n++
	return b.n <= l.max
}
