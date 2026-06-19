package jt808

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"cmsv6edu/internal/core"
)

const (
	MsgHeartbeat    uint16 = 0x0002
	MsgRegister     uint16 = 0x0100
	MsgAuth         uint16 = 0x0102
	MsgLocation     uint16 = 0x0200
	MsgGeneralReply uint16 = 0x8001
)

type Packet struct {
	MessageID uint16
	Phone     string
	Serial    uint16
	Body      []byte
	Position  *core.Position
}

func DecodeFrame(frame []byte) (Packet, error) {
	if len(frame) < 2 || frame[0] != 0x7e || frame[len(frame)-1] != 0x7e {
		return Packet{}, errors.New("jt808 frame must start and end with 0x7e")
	}
	payload, err := unescape(frame[1 : len(frame)-1])
	if err != nil {
		return Packet{}, err
	}
	if len(payload) < 13 {
		return Packet{}, fmt.Errorf("jt808 payload too short: %d", len(payload))
	}
	if checksum(payload[:len(payload)-1]) != payload[len(payload)-1] {
		return Packet{}, errors.New("jt808 checksum mismatch")
	}

	messageID := binary.BigEndian.Uint16(payload[0:2])
	props := binary.BigEndian.Uint16(payload[2:4])
	bodyLen := int(props & 0x03ff)
	phone := bcdString(payload[4:10])
	serial := binary.BigEndian.Uint16(payload[10:12])
	bodyStart := 12
	if props&(1<<13) != 0 {
		if len(payload) < 17 {
			return Packet{}, errors.New("jt808 subpackage header is incomplete")
		}
		bodyStart = 16
	}
	bodyEnd := bodyStart + bodyLen
	if bodyEnd > len(payload)-1 {
		return Packet{}, fmt.Errorf("jt808 body length out of range: %d", bodyLen)
	}

	p := Packet{MessageID: messageID, Phone: phone, Serial: serial, Body: payload[bodyStart:bodyEnd]}
	if messageID == MsgLocation {
		position, err := parseLocation(phone, p.Body)
		if err != nil {
			return Packet{}, err
		}
		p.Position = &position
	}
	return p, nil
}

func EncodeGeneralReply(phone string, serial, replyTo uint16, result byte) []byte {
	body := make([]byte, 5)
	binary.BigEndian.PutUint16(body[0:2], serial)
	binary.BigEndian.PutUint16(body[2:4], replyTo)
	body[4] = result
	return EncodeFrame(MsgGeneralReply, phone, serial, body)
}

func EncodeFrame(messageID uint16, phone string, serial uint16, body []byte) []byte {
	payload := make([]byte, 12+len(body)+1)
	binary.BigEndian.PutUint16(payload[0:2], messageID)
	binary.BigEndian.PutUint16(payload[2:4], uint16(len(body)))
	copy(payload[4:10], phoneBCD(phone))
	binary.BigEndian.PutUint16(payload[10:12], serial)
	copy(payload[12:], body)
	payload[len(payload)-1] = checksum(payload[:len(payload)-1])
	escaped := escape(payload)
	out := make([]byte, 0, len(escaped)+2)
	out = append(out, 0x7e)
	out = append(out, escaped...)
	out = append(out, 0x7e)
	return out
}

func parseLocation(deviceID string, body []byte) (core.Position, error) {
	if len(body) < 28 {
		return core.Position{}, fmt.Errorf("jt808 location body too short: %d", len(body))
	}
	alarmBits := binary.BigEndian.Uint32(body[0:4])
	statusBits := binary.BigEndian.Uint32(body[4:8])
	lat := float64(binary.BigEndian.Uint32(body[8:12])) / 1_000_000
	lon := float64(binary.BigEndian.Uint32(body[12:16])) / 1_000_000
	if statusBits&(1<<2) != 0 {
		lat = -lat
	}
	if statusBits&(1<<3) != 0 {
		lon = -lon
	}
	altitude := float64(binary.BigEndian.Uint16(body[16:18]))
	speed := float64(binary.BigEndian.Uint16(body[18:20])) / 10
	course := float64(binary.BigEndian.Uint16(body[20:22]))
	ts := bcdTime(body[22:28])

	alarm := ""
	switch {
	case alarmBits&1 != 0:
		alarm = "sos"
	case alarmBits&(1<<1) != 0:
		alarm = "overspeed"
	case alarmBits&(1<<5) != 0:
		alarm = "gnss_fault"
	}

	return core.Position{
		DeviceID:  deviceID,
		Protocol:  "jt808",
		Time:      ts,
		Latitude:  lat,
		Longitude: lon,
		SpeedKPH:  speed,
		Course:    course,
		Altitude:  altitude,
		Valid:     statusBits&1 != 0,
		Alarm:     alarm,
	}, nil
}

func unescape(in []byte) ([]byte, error) {
	out := make([]byte, 0, len(in))
	for i := 0; i < len(in); i++ {
		if in[i] != 0x7d {
			out = append(out, in[i])
			continue
		}
		i++
		if i >= len(in) {
			return nil, errors.New("dangling jt808 escape byte")
		}
		switch in[i] {
		case 0x01:
			out = append(out, 0x7d)
		case 0x02:
			out = append(out, 0x7e)
		default:
			return nil, fmt.Errorf("invalid jt808 escape sequence 0x7d 0x%02x", in[i])
		}
	}
	return out, nil
}

func escape(in []byte) []byte {
	out := make([]byte, 0, len(in))
	for _, b := range in {
		switch b {
		case 0x7d:
			out = append(out, 0x7d, 0x01)
		case 0x7e:
			out = append(out, 0x7d, 0x02)
		default:
			out = append(out, b)
		}
	}
	return out
}

func checksum(in []byte) byte {
	var x byte
	for _, b := range in {
		x ^= b
	}
	return x
}

func bcdString(in []byte) string {
	out := make([]byte, 0, len(in)*2)
	for _, b := range in {
		out = append(out, '0'+((b>>4)&0x0f), '0'+(b&0x0f))
	}
	for len(out) > 1 && out[0] == '0' {
		out = out[1:]
	}
	return string(out)
}

func phoneBCD(phone string) []byte {
	digits := make([]byte, 12)
	copy(digits[12-len(phone):], []byte(phone))
	for i := range digits {
		if digits[i] == 0 {
			digits[i] = '0'
		}
	}
	out := make([]byte, 6)
	for i := 0; i < 6; i++ {
		out[i] = ((digits[i*2] - '0') << 4) | (digits[i*2+1] - '0')
	}
	return out
}

func bcdTime(in []byte) time.Time {
	if len(in) != 6 {
		return time.Now().UTC()
	}
	year := 2000 + bcdInt(in[0])
	month := time.Month(bcdInt(in[1]))
	day := bcdInt(in[2])
	hour := bcdInt(in[3])
	min := bcdInt(in[4])
	sec := bcdInt(in[5])
	return time.Date(year, month, day, hour, min, sec, 0, time.UTC)
}

func bcdInt(value byte) int {
	return int((value>>4)&0x0f)*10 + int(value&0x0f)
}
