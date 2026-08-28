#!/usr/bin/env bash
# Rebuild assets/fonts/*.woff2 from the variable TTFs in the Styvora repo.
#
# The source faces are the same three the founder already licenses and
# self-hosts for styvora.space (Fraunces OFL, Instrument Sans OFL,
# JetBrains Mono Apache-2.0), so the two sites stay visually related.
#
# Two transforms, in this order:
#
#   1. instancer — pins the axes we never animate and keeps only `wght`.
#      Fraunces ships opsz/SOFT/WONK as well; carrying those deltas costs
#      115 KB and buys nothing, because the design uses exactly one point
#      in that space: WONK=1 (the flared, hand-cut letterforms that make
#      the headlines read as drawn rather than generated) at display
#      optical size. Pinning bakes that look in at a quarter of the bytes.
#
#   2. pyftsubset — Latin + Latin-Ext, and explicitly the Turkish set
#      İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü. A subset that drops U+0130 renders
#      "Istanbul" fine and "İstanbul" as tofu, which is the kind of defect
#      that only shows up on the Turkish half of the site.
#
# Run: bash src/tools/subset-fonts.sh   (needs fonttools[woff] + brotli)

set -euo pipefail

SRC="${FONT_SRC:-/Users/muhammedaliud/dev/sty/infra/landing/site/fonts}"
OUT="assets/fonts"
BIN="${FONTTOOLS_BIN:-}"          # optional venv bin dir
inst() { "${BIN:+$BIN/}fonttools" varLib.instancer "$@"; }
sub()  { "${BIN:+$BIN/}pyftsubset" "$@"; }

# Latin-1 + Latin Extended-A (covers all Turkish), combining marks for
# stacked diacritics, punctuation/quotes, currency, arrows, minus.
UNICODES="U+0000-00FF,U+0100-017F,U+02BB-02BC,U+02C6,U+02DA,U+02DC,\
U+0300-0301,U+0303-0304,U+0308-0309,U+2000-206F,U+20A0-20BF,U+2122,\
U+2190-2193,U+2212,U+FEFF,U+FFFD"
FEATURES='kern,liga,calt,ccmp'

mkdir -p "$OUT"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

build () {                        # build <src.ttf> <out.woff2> [axis pins…]
  local src="$1" out="$2"; shift 2
  if [ "$#" -gt 0 ]; then
    inst "$SRC/$src" "$@" -o "$tmp/$out.ttf" >/dev/null
  else
    cp "$SRC/$src" "$tmp/$out.ttf"
  fi
  sub "$tmp/$out.ttf" --unicodes="$UNICODES" --layout-features="$FEATURES" \
      --flavor=woff2 --output-file="$OUT/$out"
  printf '  %-24s %6.1f KB\n' "$out" "$(echo "scale=1; $(stat -f%z "$OUT/$out")/1024" | bc)"
}

echo "Subsetting fonts → $OUT"
build Fraunces-VariableFont.ttf       fraunces-var.woff2   opsz=144 SOFT=0 WONK=1 wght=300:700
build InstrumentSans-VariableFont.ttf instrument-var.woff2 wght=400:700
build JetBrainsMono-VariableFont.ttf  jetbrains-var.woff2  wght=400:700

# Fraunces Italic is deliberately NOT shipped: the design never sets an
# italic headline, and synthesised obliques are not used either.

cp -f "$SRC/../"[Ll][Ii][Cc]* "$OUT/" 2>/dev/null || true
echo "Done."
