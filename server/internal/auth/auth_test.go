package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAccessTokenRoundTripAndTamper(t *testing.T) {
	is := NewIssuer([]byte("k"))
	p := is.Start("u1", "test", "1.2.3.4")
	c, err := is.Verify(p.Access)
	if err != nil || c.Sub != "u1" || c.Sid != p.Session {
		t.Fatalf("verify: %+v %v", c, err)
	}
	parts := strings.Split(p.Access, ".")
	forged := parts[0] + "." + b64.EncodeToString([]byte(`{"sub":"admin","sid":"`+p.Session+`","exp":9999999999}`)) + "." + parts[2]
	if _, err := is.Verify(forged); !errors.Is(err, ErrInvalid) {
		t.Fatalf("forged token accepted: %v", err)
	}
	if _, err := NewIssuer([]byte("other")).Verify(p.Access); !errors.Is(err, ErrInvalid) {
		t.Fatal("token verified with a different key")
	}
}

func TestAccessExpires(t *testing.T) {
	is := NewIssuer([]byte("k"))
	now := time.Unix(1_700_000_000, 0)
	is.now = func() time.Time { return now }
	p := is.Start("u", "", "")
	now = now.Add(AccessTTL + time.Second)
	if _, err := is.Verify(p.Access); !errors.Is(err, ErrExpired) {
		t.Fatalf("err = %v", err)
	}
}

func TestRotationAndReuseDetection(t *testing.T) {
	is := NewIssuer([]byte("k"))
	p1 := is.Start("u", "", "")
	p2, user, err := is.Rotate(p1.Refresh, "")
	if err != nil || user != "u" || p2.Session != p1.Session || p2.Refresh == p1.Refresh {
		t.Fatalf("rotate: %+v %v", p2, err)
	}
	// an attacker replays the stolen first token: the whole family must die
	if _, _, err := is.Rotate(p1.Refresh, ""); !errors.Is(err, ErrReused) {
		t.Fatalf("reuse not detected: %v", err)
	}
	if _, _, err := is.Rotate(p2.Refresh, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("legitimate token still works after reuse: %v", err)
	}
	if _, err := is.Verify(p2.Access); !errors.Is(err, ErrInvalid) {
		t.Fatal("access token of a revoked session still valid")
	}
}

func TestRevokeOnlyOwnSession(t *testing.T) {
	is := NewIssuer([]byte("k"))
	a := is.Start("alice", "", "")
	if is.Revoke("mallory", a.Session) {
		t.Fatal("revoked someone else's session")
	}
	if !is.Revoke("alice", a.Session) || len(is.Sessions("alice")) != 0 {
		t.Fatal("own session not revoked")
	}
}
