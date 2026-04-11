#!/usr/bin/env bash
# Creates a self-signed code-signing certificate for local development.
# This stops macOS from prompting for Keychain access on every launch.
#
# Usage: ./scripts/setup-dev-codesign.sh
#
# The certificate is created in the login keychain and trusted for code signing.
# Run once — the cert persists across reboots.

set -euo pipefail

CERT_NAME="Canopy Dev"

# Check if certificate already exists
if security find-identity -v -p codesigning | grep -q "$CERT_NAME"; then
  echo "✓ Certificate '$CERT_NAME' already exists."
  exit 0
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/cert.conf" <<EOF
[req]
distinguished_name = req_dn
x509_extensions = codesign
prompt = no

[req_dn]
CN = $CERT_NAME

[codesign]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
EOF

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMPDIR/key.pem" \
  -out "$TMPDIR/cert.pem" \
  -days 3650 \
  -config "$TMPDIR/cert.conf" \
  2>/dev/null

PASS="canopy-dev-temp"

openssl pkcs12 -export \
  -inkey "$TMPDIR/key.pem" \
  -in "$TMPDIR/cert.pem" \
  -out "$TMPDIR/cert.p12" \
  -passout "pass:$PASS" \
  2>/dev/null

security import "$TMPDIR/cert.p12" \
  -k ~/Library/Keychains/login.keychain-db \
  -T /usr/bin/codesign \
  -f pkcs12 \
  -P "$PASS"

# Trust the certificate for code signing (will prompt for password)
security add-trusted-cert -p codeSign -k ~/Library/Keychains/login.keychain-db "$TMPDIR/cert.pem"

echo ""
echo "✓ Certificate '$CERT_NAME' installed and trusted."
echo "  Dev builds will be codesigned automatically."
