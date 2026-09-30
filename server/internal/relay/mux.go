package relay

import (
	"bufio"
	"io"
	"net"
	"sync"
)

// session multiplexes streams over one connection. Writes are serialized by a
// mutex; one reader goroutine routes incoming frames to per-stream pipes.
type session struct {
	conn net.Conn
	bw   *bufio.Writer
	wmu  sync.Mutex

	mu      sync.Mutex
	streams map[uint32]*stream
	next    uint32
	closed  chan struct{}
	onOpen  func(*stream) // set on the agent side
}

type stream struct {
	id   uint32
	s    *session
	pr   *io.PipeReader
	pw   *io.PipeWriter
	once sync.Once
}

func newSession(c net.Conn) *session {
	return &session{conn: c, bw: bufio.NewWriterSize(c, 64<<10), streams: map[uint32]*stream{}, closed: make(chan struct{})}
}

func (s *session) send(f frame) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if err := writeFrame(s.bw, f); err != nil {
		return err
	}
	return s.bw.Flush()
}

func (s *session) newStream(id uint32) *stream {
	pr, pw := io.Pipe()
	st := &stream{id: id, s: s, pr: pr, pw: pw}
	s.mu.Lock()
	s.streams[id] = st
	s.mu.Unlock()
	return st
}

// open starts a stream from the edge side.
func (s *session) open() (*stream, error) {
	s.mu.Lock()
	s.next++
	id := s.next
	s.mu.Unlock()
	st := s.newStream(id)
	return st, s.send(frame{typ: frameOpen, stream: id})
}

// serve routes frames until the connection dies, then fails every open stream.
func (s *session) serve(r io.Reader) error {
	defer func() {
		close(s.closed)
		s.mu.Lock()
		for _, st := range s.streams {
			st.pw.CloseWithError(io.ErrUnexpectedEOF)
		}
		s.mu.Unlock()
	}()
	for {
		f, err := readFrame(r)
		if err != nil {
			return err
		}
		switch f.typ {
		case frameOpen:
			st := s.newStream(f.stream)
			if s.onOpen != nil {
				go s.onOpen(st)
			}
		case frameData:
			s.mu.Lock()
			st := s.streams[f.stream]
			s.mu.Unlock()
			if st != nil {
				// the pipe applies backpressure: a slow consumer stalls this connection,
				// which is acceptable for developer traffic and keeps memory bounded
				st.pw.Write(f.payload)
			}
		case frameClose:
			s.mu.Lock()
			st := s.streams[f.stream]
			delete(s.streams, f.stream)
			s.mu.Unlock()
			if st != nil {
				st.pw.Close()
			}
		}
	}
}

func (st *stream) Read(p []byte) (int, error) { return st.pr.Read(p) }

func (st *stream) Write(p []byte) (int, error) {
	total := 0
	for len(p) > 0 {
		n := min(len(p), 32<<10)
		if err := st.s.send(frame{typ: frameData, stream: st.id, payload: append([]byte(nil), p[:n]...)}); err != nil {
			return total, err
		}
		total += n
		p = p[n:]
	}
	return total, nil
}

// CloseWrite tells the peer no more data will come from this side.
func (st *stream) CloseWrite() error {
	var err error
	st.once.Do(func() { err = st.s.send(frame{typ: frameClose, stream: st.id}) })
	return err
}
