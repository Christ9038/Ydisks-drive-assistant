#!/usr/bin/env bash

set -euo pipefail

# Generate a local self-signed Windows code-signing certificate.
# The output directory is ignored by git; never commit any generated file.
OUT_DIR="${1:-.local/windows-signing}"
SUBJECT="${WINDOWS_SIGNING_SUBJECT:-Ydisks Transfer Assistant (Self-Signed)}"
DAYS="${WINDOWS_SIGNING_DAYS:-825}"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

KEY_FILE="$OUT_DIR/windows-code-signing.key"
CERT_FILE="$OUT_DIR/windows-code-signing.crt"
PFX_FILE="$OUT_DIR/windows-code-signing.pfx"
B64_FILE="$OUT_DIR/windows-code-signing.pfx.b64"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required (OpenSSL 1.1.1 or newer)." >&2
  exit 1
fi

read -r -s -p "PFX password: " PFX_PASSWORD
echo
read -r -s -p "Confirm PFX password: " PFX_PASSWORD_CONFIRM
echo

if [[ -z "$PFX_PASSWORD" || "$PFX_PASSWORD" != "$PFX_PASSWORD_CONFIRM" ]]; then
  echo "Passwords are empty or do not match." >&2
  exit 1
fi
unset PFX_PASSWORD_CONFIRM

openssl req \
  -x509 \
  -newkey rsa:3072 \
  -sha256 \
  -days "$DAYS" \
  -nodes \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -subj "/CN=$SUBJECT" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

export PFX_PASSWORD
openssl pkcs12 \
  -export \
  -out "$PFX_FILE" \
  -inkey "$KEY_FILE" \
  -in "$CERT_FILE" \
  -name "$SUBJECT" \
  -macalg sha256 \
  -passout env:PFX_PASSWORD
unset PFX_PASSWORD

openssl base64 -A -in "$PFX_FILE" -out "$B64_FILE"
chmod 600 "$KEY_FILE" "$PFX_FILE" "$B64_FILE"

THUMBPRINT="$(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha1 | awk -F= '{print $2}' | tr -d ':')"

echo
echo "Generated Windows code-signing certificate:"
echo "  PFX:        $PFX_FILE"
echo "  Secret text: $B64_FILE"
echo "  Thumbprint:  $THUMBPRINT"
echo
echo "Copy the complete contents of $B64_FILE to the GitHub Secret WINDOWS_CERTIFICATE."
echo "Use the PFX password as the GitHub Secret WINDOWS_CERTIFICATE_PASSWORD."
