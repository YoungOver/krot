package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"
)

var hopHeaders = map[string]bool{"host": true, "content-length": true, "connection": true, "x-forwarded-for": true, "x-forwarded-proto": true}

// ReplayThrough re-sends a recorded request through h (the edge) with the
// original method, path, headers and body.
func ReplayThrough(h http.Handler, host, method, path string, headers map[string]string, body string) (int, time.Duration, error) {
	if !strings.HasPrefix(path, "/") {
		return 0, 0, errors.New("bad path")
	}
	req := httptest.NewRequest(method, "http://"+host+path, strings.NewReader(body))
	req.Host = host
	req.RemoteAddr = "127.0.0.1:0"
	for k, v := range headers {
		if !hopHeaders[strings.ToLower(k)] {
			req.Header.Set(k, v)
		}
	}
	req.Header.Set("X-Krot-Replay", "1")
	rec := httptest.NewRecorder()
	start := time.Now()
	h.ServeHTTP(rec, req)
	return rec.Code, time.Since(start), nil
}
