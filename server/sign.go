package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

// Release signing key for arutosio.com bundles. The matching private seed is
// kept outside the repository and used only by the release workflow
// (ARUTOSIO_SIGNING_KEY). Rotate both sides with -update-pubkey.
const embeddedUpdatePubkey = "bf19fb6034428ea03395f38bcb52e1cfd1a5f2a16db2780f49d325294bfc3a2d"

func decodeUpdatePubkey(raw string) (ed25519.PublicKey, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, false
	}
	if b, err := hex.DecodeString(raw); err == nil && len(b) == ed25519.PublicKeySize {
		return ed25519.PublicKey(b), true
	}
	return nil, false
}

func verifyReleaseSignature(pub ed25519.PublicKey, payload, sigB64 []byte) bool {
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigB64)))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(pub, payload, sig)
}
