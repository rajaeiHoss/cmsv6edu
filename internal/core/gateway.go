package core

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"time"

	"cmsv6edu/internal/protocol/jt808"
	"cmsv6edu/internal/protocol/wialonips"
)

func ServeWialonIPS(ctx context.Context, addr string, store *Store) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	slog.Info("wialon ips gateway listening", "addr", addr)
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go handleWialonConn(conn, store)
	}
}

func handleWialonConn(conn net.Conn, store *Store) {
	defer conn.Close()
	var deviceID string
	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		msg, err := wialonips.ParseLine(scanner.Text())
		if err != nil {
			_, _ = conn.Write([]byte("#NA\r\n"))
			slog.Warn("wialon packet rejected", "remote", conn.RemoteAddr(), "error", err)
			continue
		}
		switch msg.Kind {
		case "login":
			deviceID = msg.DeviceID
			store.UpsertDevice(deviceID, "wialon_ips", true)
			_, _ = conn.Write([]byte("#AL#1\r\n"))
		case "data":
			if deviceID == "" {
				_, _ = conn.Write([]byte("#AD#-1\r\n"))
				continue
			}
			p := *msg.Position
			p.DeviceID = deviceID
			store.AddPosition(p)
			_, _ = conn.Write([]byte("#AD#1\r\n"))
		}
	}
	if deviceID != "" {
		store.SetOffline(deviceID)
	}
}

func ServeJT808(ctx context.Context, addr string, store *Store) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	slog.Info("jt808 gateway listening", "addr", addr)
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go handleJT808Conn(conn, store)
	}
}

func handleJT808Conn(conn net.Conn, store *Store) {
	defer conn.Close()
	for {
		frame, err := readJT808Frame(conn)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				slog.Warn("jt808 connection closed", "remote", conn.RemoteAddr(), "error", err)
			}
			return
		}
		packet, err := jt808.DecodeFrame(frame)
		if err != nil {
			slog.Warn("jt808 packet rejected", "remote", conn.RemoteAddr(), "error", err)
			continue
		}
		store.UpsertDevice(packet.Phone, "jt808", true)
		if packet.Position != nil {
			store.AddPosition(*packet.Position)
		}
		_, _ = conn.Write(jt808.EncodeGeneralReply(packet.Phone, packet.Serial, packet.MessageID, 0))
	}
}

func readJT808Frame(r io.Reader) ([]byte, error) {
	var buf bytes.Buffer
	tmp := make([]byte, 1)
	inFrame := false
	deadlineReader, hasDeadline := r.(interface{ SetReadDeadline(time.Time) error })
	if hasDeadline {
		_ = deadlineReader.SetReadDeadline(time.Now().Add(10 * time.Minute))
	}
	for {
		n, err := r.Read(tmp)
		if err != nil {
			return nil, err
		}
		if n == 0 {
			continue
		}
		b := tmp[0]
		if b == 0x7e {
			if !inFrame {
				inFrame = true
				buf.Reset()
				buf.WriteByte(b)
				continue
			}
			buf.WriteByte(b)
			return buf.Bytes(), nil
		}
		if inFrame {
			if buf.Len() > 4096 {
				return nil, fmt.Errorf("jt808 frame too large")
			}
			buf.WriteByte(b)
		}
	}
}
