// krot is the client: it keeps an outbound connection to the edge and forwards
// public requests for one subdomain to a local port.
//
//	krot http 3000 --subdomain shop --token krt_... [--edge localhost:7000]
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/YoungOver/krot/server/internal/relay"
)

func main() {
	if len(os.Args) < 3 || os.Args[1] != "http" {
		fmt.Fprintln(os.Stderr, "использование: krot http <порт> --subdomain имя --token krt_...")
		os.Exit(2)
	}
	port, err := strconv.Atoi(os.Args[2])
	if err != nil || port < 1 || port > 65535 {
		fmt.Fprintln(os.Stderr, "порт должен быть числом от 1 до 65535")
		os.Exit(2)
	}
	fs := flag.NewFlagSet("http", flag.ExitOnError)
	sub := fs.String("subdomain", "", "поддомен туннеля из кабинета")
	token := fs.String("token", os.Getenv("KROT_TOKEN"), "токен из раздела «Токены»")
	edge := fs.String("edge", "localhost:7000", "адрес узла")
	fs.Parse(os.Args[3:])

	a := &relay.Agent{Edge: *edge, Token: *token, Subdomain: *sub, Local: fmt.Sprintf("127.0.0.1:%d", port)}
	backoff := time.Second
	for {
		err := a.Run(func(url string) {
			backoff = time.Second
			fmt.Printf("● %s → localhost:%d\n", url, port)
		})
		if errors.Is(err, relay.ErrRejected) {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		// network trouble: reconnect with capped exponential backoff, same address
		fmt.Fprintf(os.Stderr, "соединение потеряно (%v), переподключение через %s\n", err, backoff)
		time.Sleep(backoff)
		backoff = min(backoff*2, 30*time.Second)
	}
}
