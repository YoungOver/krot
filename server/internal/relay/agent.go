package relay

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"time"
)

// Agent runs next to the developer's server and forwards streams to it.
type Agent struct {
	Edge      string // host:port of the edge agent listener
	Token     string
	Subdomain string
	Local     string // host:port of the local server, e.g. 127.0.0.1:3000
}

// Run connects, returns the public URL through ready, and forwards until the
// connection drops.
func (a *Agent) Run(ready func(url string)) error {
	c, err := net.DialTimeout("tcp", a.Edge, 10*time.Second)
	if err != nil {
		return err
	}
	defer c.Close()
	s := newSession(c)
	body, _ := json.Marshal(hello{Token: a.Token, Subdomain: a.Subdomain})
	if err := s.send(frame{typ: frameHello, payload: body}); err != nil {
		return err
	}
	br := bufio.NewReader(c)
	f, err := readFrame(br)
	if err != nil {
		return err
	}
	if f.typ != frameHelloOK {
		return fmt.Errorf("%w: %s", ErrRejected, f.payload)
	}
	if ready != nil {
		ready(string(f.payload))
	}
	s.onOpen = a.forward
	return s.serve(br)
}

func (a *Agent) forward(st *stream) {
	defer st.CloseWrite()
	local, err := net.DialTimeout("tcp", a.Local, 5*time.Second)
	if err != nil {
		io.WriteString(st, "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nЛокальный сервер "+a.Local+" недоступен\n")
		io.Copy(io.Discard, st)
		return
	}
	defer local.Close()
	go func() {
		io.Copy(local, st)
		if tc, ok := local.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
	}()
	io.Copy(st, local)
}
