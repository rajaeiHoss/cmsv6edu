package jt808

import (
	"encoding/binary"
	"testing"
)

func TestLocationRoundTrip(t *testing.T) {
	body := make([]byte, 28)
	binary.BigEndian.PutUint32(body[4:8], 1)
	binary.BigEndian.PutUint32(body[8:12], 35689123)
	binary.BigEndian.PutUint32(body[12:16], 51420123)
	binary.BigEndian.PutUint16(body[16:18], 120)
	binary.BigEndian.PutUint16(body[18:20], 725)
	binary.BigEndian.PutUint16(body[20:22], 180)
	copy(body[22:28], []byte{0x26, 0x06, 0x19, 0x10, 0x15, 0x30})

	frame := EncodeFrame(MsgLocation, "123456789012", 7, body)
	packet, err := DecodeFrame(frame)
	if err != nil {
		t.Fatal(err)
	}
	if packet.MessageID != MsgLocation || packet.Phone != "123456789012" {
		t.Fatalf("unexpected packet: %+v", packet)
	}
	if packet.Position == nil || packet.Position.SpeedKPH != 72.5 {
		t.Fatalf("bad position: %+v", packet.Position)
	}
}
