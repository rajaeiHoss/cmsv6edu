package core

import "time"

type Device struct {
	ID           string    `json:"id"`
	Protocol     string    `json:"protocol"`
	Online       bool      `json:"online"`
	LastSeen     time.Time `json:"lastSeen"`
	LastPosition *Position `json:"lastPosition,omitempty"`
}

type Position struct {
	DeviceID  string            `json:"deviceId"`
	Protocol  string            `json:"protocol"`
	Time      time.Time         `json:"time"`
	Latitude  float64           `json:"latitude"`
	Longitude float64           `json:"longitude"`
	SpeedKPH  float64           `json:"speedKph"`
	Course    float64           `json:"course"`
	Altitude  float64           `json:"altitude"`
	Satellites int               `json:"satellites"`
	Valid     bool              `json:"valid"`
	Alarm     string            `json:"alarm,omitempty"`
	Attrs     map[string]string `json:"attrs,omitempty"`
}

type Alarm struct {
	ID        string    `json:"id"`
	DeviceID  string    `json:"deviceId"`
	Type      string    `json:"type"`
	Severity  string    `json:"severity"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"createdAt"`
}

type Snapshot struct {
	Devices   []Device   `json:"devices"`
	Positions []Position `json:"positions"`
	Alarms    []Alarm    `json:"alarms"`
}
