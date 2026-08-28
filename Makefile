# Two build modes. The committed artefact is whichever one is live.
#
#   make preview   → paths prefixed /spaceailabs, for maliud.github.io
#   make site      → root paths, for spaceailabs.ai (cutover; add CNAME)
#   make fonts     → re-subset the woff2 faces from the licensed TTFs
#   make check     → rebuild and fail if the committed artefact is stale

preview: ; BASE=/spaceailabs node src/build.mjs
site:    ; node src/build.mjs
fonts:   ; bash src/tools/subset-fonts.sh
check:   ; @node src/build.mjs >/dev/null && git diff --exit-code --stat || \
	  (echo "Committed artefact is stale — run make and commit"; exit 1)
.PHONY: preview site fonts check
