package wialonips

import "testing"

func TestParseLogin(t *testing.T) {
	msg, err := ParseLine("#L#123456789012345;secret\r\n")
	if err != nil {
		t.Fatal(err)
	}
	if msg.Kind != "login" || msg.DeviceID != "123456789012345" || msg.Password != "secret" {
		t.Fatalf("unexpected login: %+v", msg)
	}
}

func TestParseData(t *testing.T) {
	msg, err := ParseLine("#D#190626;101530;3540.0000;N;05125.0000;E;72;180;120;8;1.0;;;;;ignition:1")
	if err != nil {
		t.Fatal(err)
	}
	if msg.Position == nil {
		t.Fatal("missing position")
	}
	if msg.Position.Latitude < 35.66 || msg.Position.Latitude > 35.67 {
		t.Fatalf("bad latitude: %f", msg.Position.Latitude)
	}
	if msg.Position.Longitude < 51.41 || msg.Position.Longitude > 51.42 {
		t.Fatalf("bad longitude: %f", msg.Position.Longitude)
	}
}
