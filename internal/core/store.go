package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	mu        sync.RWMutex
	devices   map[string]Device
	positions []Position
	alarms    []Alarm
	events    chan Event
	dataPath  string
	maxPoints int
}

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

func NewStore(dataPath string, maxPoints int) *Store {
	if maxPoints <= 0 {
		maxPoints = 10000
	}
	return &Store{
		devices:   make(map[string]Device),
		events:    make(chan Event, 512),
		dataPath:  dataPath,
		maxPoints: maxPoints,
	}
}

func (s *Store) Events() <-chan Event {
	return s.events
}

func (s *Store) UpsertDevice(id, protocol string, online bool) Device {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()

	d := s.devices[id]
	d.ID = id
	d.Protocol = protocol
	d.Online = online
	d.LastSeen = now
	s.devices[id] = d
	s.publish(Event{Type: "device", Data: d})
	return d
}

func (s *Store) SetOffline(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.devices[id]
	if !ok {
		return
	}
	d.Online = false
	s.devices[id] = d
	s.publish(Event{Type: "device", Data: d})
}

func (s *Store) AddPosition(p Position) {
	if p.Time.IsZero() {
		p.Time = time.Now().UTC()
	}
	if p.Attrs == nil {
		p.Attrs = map[string]string{}
	}

	s.mu.Lock()
	d := s.devices[p.DeviceID]
	d.ID = p.DeviceID
	d.Protocol = p.Protocol
	d.Online = true
	d.LastSeen = time.Now().UTC()
	cp := p
	d.LastPosition = &cp
	s.devices[p.DeviceID] = d

	s.positions = append(s.positions, p)
	if len(s.positions) > s.maxPoints {
		s.positions = s.positions[len(s.positions)-s.maxPoints:]
	}
	s.mu.Unlock()

	s.appendJSONL("positions.jsonl", p)
	s.publish(Event{Type: "position", Data: p})

	if p.Alarm != "" {
		s.AddAlarm(Alarm{
			ID:        fmt.Sprintf("%s-%d", p.DeviceID, time.Now().UnixNano()),
			DeviceID:  p.DeviceID,
			Type:      p.Alarm,
			Severity:  "warning",
			Message:   fmt.Sprintf("%s reported %s", p.DeviceID, p.Alarm),
			CreatedAt: time.Now().UTC(),
		})
	}
}

func (s *Store) AddAlarm(a Alarm) {
	if a.CreatedAt.IsZero() {
		a.CreatedAt = time.Now().UTC()
	}
	if a.ID == "" {
		a.ID = fmt.Sprintf("%s-%d", a.DeviceID, time.Now().UnixNano())
	}

	s.mu.Lock()
	s.alarms = append(s.alarms, a)
	if len(s.alarms) > 1000 {
		s.alarms = s.alarms[len(s.alarms)-1000:]
	}
	s.mu.Unlock()

	s.appendJSONL("alarms.jsonl", a)
	s.publish(Event{Type: "alarm", Data: a})
}

func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	devices := make([]Device, 0, len(s.devices))
	for _, d := range s.devices {
		devices = append(devices, d)
	}
	positions := append([]Position(nil), s.positions...)
	alarms := append([]Alarm(nil), s.alarms...)
	return Snapshot{Devices: devices, Positions: positions, Alarms: alarms}
}

func (s *Store) DeviceHistory(deviceID string, limit int) []Position {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]Position, 0, limit)
	for i := len(s.positions) - 1; i >= 0 && len(out) < limit; i-- {
		if s.positions[i].DeviceID == deviceID {
			out = append(out, s.positions[i])
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func (s *Store) publish(e Event) {
	select {
	case s.events <- e:
	default:
		slog.Warn("dropping event because subscriber queue is full", "type", e.Type)
	}
}

func (s *Store) appendJSONL(name string, value any) {
	if s.dataPath == "" {
		return
	}
	if err := os.MkdirAll(s.dataPath, 0o755); err != nil {
		slog.Warn("creating data directory failed", "error", err)
		return
	}
	f, err := os.OpenFile(filepath.Join(s.dataPath, name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		slog.Warn("opening event log failed", "error", err)
		return
	}
	defer f.Close()
	if err := json.NewEncoder(f).Encode(value); err != nil {
		slog.Warn("writing event log failed", "error", err)
	}
}
