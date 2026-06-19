package wialonips

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"cmsv6edu/internal/core"
)

type Message struct {
	Kind     string
	DeviceID string
	Password string
	Position *core.Position
}

func ParseLine(line string) (Message, error) {
	line = strings.TrimSpace(line)
	if strings.HasPrefix(line, "#L#") {
		parts := strings.Split(strings.TrimPrefix(line, "#L#"), ";")
		if len(parts) < 1 || parts[0] == "" {
			return Message{}, errors.New("missing imei in login")
		}
		msg := Message{Kind: "login", DeviceID: parts[0]}
		if len(parts) > 1 {
			msg.Password = parts[1]
		}
		return msg, nil
	}
	if strings.HasPrefix(line, "#D#") {
		p, err := parseData(strings.TrimPrefix(line, "#D#"))
		if err != nil {
			return Message{}, err
		}
		return Message{Kind: "data", Position: &p}, nil
	}
	return Message{}, fmt.Errorf("unsupported wialon ips packet: %q", line)
}

func parseData(payload string) (core.Position, error) {
	parts := strings.Split(payload, ";")
	if len(parts) < 10 {
		return core.Position{}, fmt.Errorf("wialon data packet expects at least 10 fields, got %d", len(parts))
	}
	ts, err := parseTime(parts[0], parts[1])
	if err != nil {
		return core.Position{}, err
	}
	lat, err := parseCoord(parts[2], parts[3])
	if err != nil {
		return core.Position{}, fmt.Errorf("latitude: %w", err)
	}
	lon, err := parseCoord(parts[4], parts[5])
	if err != nil {
		return core.Position{}, fmt.Errorf("longitude: %w", err)
	}
	speed, _ := parseFloat(parts[6])
	course, _ := parseFloat(parts[7])
	altitude, _ := parseFloat(parts[8])
	sats, _ := strconv.Atoi(emptyZero(parts[9]))

	attrs := map[string]string{}
	if len(parts) > 10 {
		attrs["hdop"] = parts[10]
	}
	if len(parts) > 15 {
		attrs["params"] = parts[15]
	}

	return core.Position{
		Protocol:   "wialon_ips",
		Time:       ts,
		Latitude:   lat,
		Longitude:  lon,
		SpeedKPH:   speed,
		Course:     course,
		Altitude:   altitude,
		Satellites: sats,
		Valid:      true,
		Attrs:      attrs,
	}, nil
}

func parseTime(date, clock string) (time.Time, error) {
	if date == "NA" || clock == "NA" || date == "" || clock == "" {
		return time.Now().UTC(), nil
	}
	if len(date) != 6 || len(clock) != 6 {
		return time.Time{}, fmt.Errorf("invalid date/time %q %q", date, clock)
	}
	return time.ParseInLocation("020106150405", date+clock, time.UTC)
}

func parseCoord(value, hemisphere string) (float64, error) {
	if value == "" || value == "NA" {
		return 0, errors.New("missing coordinate")
	}
	raw, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, err
	}
	deg := int(raw / 100)
	min := raw - float64(deg*100)
	coord := float64(deg) + min/60
	switch strings.ToUpper(hemisphere) {
	case "S", "W":
		coord = -coord
	case "N", "E", "":
	default:
		return 0, fmt.Errorf("invalid hemisphere %q", hemisphere)
	}
	return coord, nil
}

func parseFloat(value string) (float64, error) {
	return strconv.ParseFloat(emptyZero(value), 64)
}

func emptyZero(value string) string {
	if value == "" || value == "NA" {
		return "0"
	}
	return value
}
