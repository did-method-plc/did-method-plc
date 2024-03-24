package didplc

import (
	"fmt"
	"time"

	"github.com/bluesky-social/indigo/atproto/crypto"
	"github.com/bluesky-social/indigo/atproto/syntax"
)

type LogEntry struct {
	DID       string `json:"did"`
	Operation OpEnum `json:"operation"`
	CID       string `json:"cid"`
	Nullified bool   `json:"nullified"`
	CreatedAt string `json:"createdAt"`
}

// Checks self-consistency of this log entry in isolation. Does not access other context or log entries.
func (le *LogEntry) Validate() error {

	if le.Operation.Regular != nil {
		if le.CID != le.Operation.Regular.CID().String() {
			return fmt.Errorf("log entry CID didn't match computed operation CID")
		}
		// NOTE: for non-genesis ops, the rotation key may have bene in a previous op
		if le.Operation.Regular.IsGenesis() {
			did, err := le.Operation.Regular.DID()
			if err != nil {
				return err
			}
			if le.DID != did {
				return fmt.Errorf("log entry DID didn't match computed genesis operation DID")
			}
			if err := VerifySignatureAny(le.Operation.Regular, le.Operation.Regular.RotationKeys); err != nil {
				return fmt.Errorf("failed to validate op genesis signature: %v", err)
			}
		}
	} else if le.Operation.Legacy != nil {
		if le.CID != le.Operation.Legacy.CID().String() {
			return fmt.Errorf("log entry CID didn't match computed operation CID")
		}
		// NOTE: for non-genesis ops, the rotation key may have bene in a previous op
		if le.Operation.Legacy.IsGenesis() {
			did, err := le.Operation.Legacy.DID()
			if err != nil {
				return err
			}
			if le.DID != did {
				return fmt.Errorf("log entry DID didn't match computed genesis operation DID")
			}
			// TODO: try both signing and recovery key?
			pub, err := crypto.ParsePublicDIDKey(le.Operation.Legacy.SigningKey)
			if err != nil {
				return fmt.Errorf("could not parse recovery key: %v", err)
			}
			if err := le.Operation.Legacy.VerifySignature(pub); err != nil {
				return fmt.Errorf("failed to validate legacy op genesis signature: %v", err)
			}
		}
	} else if le.Operation.Tombstone != nil {
		if le.CID != le.Operation.Tombstone.CID().String() {
			return fmt.Errorf("log entry CID didn't match computed operation CID")
		}
		// NOTE: for tombstones, the rotation key is always in a previous op
	} else {
		return fmt.Errorf("expected tombstone, legacy, or regular PLC operation")
	}

	return nil
}

// checks and ordered list of operations for a single DID.
//
// can be a full audit log (with nullified entries), or a simple log (only "active" entries)
func VerifyOpLog(entries []LogEntry) error {
	if len(entries) == 0 {
		return fmt.Errorf("can't verify empty operation log")
	}
	tombstoned := false
	earliestNullified := ""
	lastTS := ""
	var last *RegularOp
	var err error

	for _, oe := range entries {
		var op RegularOp

		if err = oe.Validate(); err != nil {
			return err
		}

		if last == nil {
			// special processing of first operation
			if oe.Operation.Regular != nil {
				op = *oe.Operation.Regular
			} else if oe.Operation.Legacy != nil {
				op = oe.Operation.Legacy.RegularOp()
			} else {
				return fmt.Errorf("first log entry must be a plc_operation or create (legacy)")
			}

			err := VerifySignatureAny(&op, op.RotationKeys)
			if err != nil {
				return err
			}

			if oe.Nullified {
				return fmt.Errorf("first log entry can't be nullified")
			}

			last = &op
			lastTS = oe.CreatedAt
			continue
		}

		if oe.CreatedAt < lastTS {
			return fmt.Errorf("operation log was not ordered by timestamp")
		}
		if tombstoned {
			return fmt.Errorf("account was successfully tombstoned, expect end of op log")
		}

		if !oe.Nullified && earliestNullified != "" {
			earliest, err := syntax.ParseDatetime(earliestNullified)
			if err != nil {
				return err
			}
			current, err := syntax.ParseDatetime(oe.CreatedAt)
			if err != nil {
				return err
			}
			if current.Time().Sub(earliest.Time()) > 72*time.Hour {
				return fmt.Errorf("time gap between nullified event and overriding event more than recovery window")
			}
			earliestNullified = ""
		}

		if oe.Nullified && earliestNullified == "" {
			earliestNullified = oe.CreatedAt
		}

		if oe.Operation.Tombstone != nil {
			if err := VerifySignatureAny(oe.Operation.Tombstone, last.RotationKeys); err != nil {
				return err
			}
			if oe.Nullified {
				continue
			}
			tombstoned = true
			lastTS = oe.CreatedAt
			continue
		} else if oe.Operation.Regular != nil {
			op = *oe.Operation.Regular
		} else {
			return fmt.Errorf("expected a plc_operation or plc_tombstone operation")
		}

		if err := VerifySignatureAny(&op, last.RotationKeys); err != nil {
			return err
		}
		if oe.Nullified {
			continue
		} else {
			last = &op
			lastTS = oe.CreatedAt
		}
	}

	if earliestNullified != "" {
		return fmt.Errorf("outstanding 'nullified' op at end of log")
	}
	return nil
}
