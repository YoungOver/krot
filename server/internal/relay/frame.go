// Package relay carries HTTP requests from the public edge to an agent running
// next to the developer's server, over one outbound TCP connection per agent.
//
// Frame: type u8 | stream u32 | length u32 | payload. Many HTTP exchanges share
// one connection as independent streams, so the agent never needs an open port.
package relay

import (
	"encoding/binary"
	"errors"
	"io"
)

const (
	frameHello   byte = 1 // agent -> edge: token + requested subdomain
	frameHelloOK byte = 2 // edge -> agent: public URL, or error text
	frameOpen    byte = 3 // edge -> agent: new stream
	frameData    byte = 4 // both ways
	frameClose   byte = 5 // both ways: half-close of a stream
	frameError   byte = 6 // edge -> agent: fatal handshake error

	maxPayload = 256 << 10
)

var errFrameTooBig = errors.New("relay: frame exceeds limit")

type frame struct {
	typ     byte
	stream  uint32
	payload []byte
}

func writeFrame(w io.Writer, f frame) error {
	var hdr [9]byte
	hdr[0] = f.typ
	binary.BigEndian.PutUint32(hdr[1:], f.stream)
	binary.BigEndian.PutUint32(hdr[5:], uint32(len(f.payload)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.Write(f.payload)
	return err
}

func readFrame(r io.Reader) (frame, error) {
	var hdr [9]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return frame{}, err
	}
	n := binary.BigEndian.Uint32(hdr[5:])
	if n > maxPayload {
		return frame{}, errFrameTooBig
	}
	f := frame{typ: hdr[0], stream: binary.BigEndian.Uint32(hdr[1:]), payload: make([]byte, n)}
	_, err := io.ReadFull(r, f.payload)
	return f, err
}
