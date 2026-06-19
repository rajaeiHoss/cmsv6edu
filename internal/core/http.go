package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

func NewHTTPHandler(store *Store, static http.FileSystem) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/snapshot", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, store.Snapshot())
	})
	mux.HandleFunc("GET /api/devices/{id}/history", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		writeJSON(w, store.DeviceHistory(r.PathValue("id"), limit))
	})
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		streamEvents(w, r, store)
	})
	mux.HandleFunc("POST /api/simulate/position", func(w http.ResponseWriter, r *http.Request) {
		var p Position
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(p.DeviceID) == "" {
			http.Error(w, "deviceId is required", http.StatusBadRequest)
			return
		}
		if p.Protocol == "" {
			p.Protocol = "simulator"
		}
		p.Valid = true
		store.AddPosition(p)
		writeJSON(w, p)
	})
	mux.Handle("/", http.FileServer(static))
	return loggingMiddleware(mux)
}

func streamEvents(w http.ResponseWriter, r *http.Request, store *Store) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	events := store.Events()
	for {
		select {
		case <-r.Context().Done():
			return
		case e := <-events:
			b, err := json.Marshal(e)
			if err != nil {
				slog.Warn("event marshal failed", "error", err)
				continue
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
