package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"cmsv6edu/internal/core"
)

func main() {
	httpAddr := flag.String("http", env("HTTP_ADDR", ":8080"), "HTTP dashboard/API listen address")
	wialonAddr := flag.String("wialon", env("WIALON_ADDR", ":20332"), "Wialon IPS TCP listen address")
	jt808Addr := flag.String("jt808", env("JT808_ADDR", ":20380"), "JT808 TCP listen address")
	dataPath := flag.String("data", env("DATA_PATH", "data"), "JSONL persistence directory")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store := core.NewStore(*dataPath, 20000)

	go func() {
		if err := core.ServeWialonIPS(ctx, *wialonAddr, store); err != nil {
			slog.Error("wialon gateway failed", "error", err)
			stop()
		}
	}()
	go func() {
		if err := core.ServeJT808(ctx, *jt808Addr, store); err != nil {
			slog.Error("jt808 gateway failed", "error", err)
			stop()
		}
	}()

	server := &http.Server{
		Addr:    *httpAddr,
		Handler: core.NewHTTPHandler(store, http.Dir("web")),
	}
	go func() {
		slog.Info("http server listening", "addr", *httpAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	_ = server.Shutdown(context.Background())
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
