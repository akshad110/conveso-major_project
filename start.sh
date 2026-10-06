#!/usr/bin/env bash
#
# Bring the suite up for development.
#
# Four processes, because there are four runtimes. They are started in dependency
# order and the whole group dies together — a stray engine holding port 4177 after
# a Ctrl-C is the single most common way to lose an afternoon on this project.
#
#   engine     127.0.0.1:4177   the WebSocket the courtroom talks to
#   courtroom  127.0.0.1:5173   Vite, React 18, the 3D hearing
#   classroom  127.0.0.1:3001   Next 14, React 18, the language room
#   lms        127.0.0.1:3000   Next 15, React 19, Converso itself
#
# The LMS is last on purpose: it is the one you open, and by the time it answers
# the two scenes it launches are already listening.
#
# Usage:  ./start.sh            everything
#         ./start.sh lms        just Converso
#         ./start.sh engine courtroom
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "No node_modules. Run: npm install" >&2
  exit 1
fi

# Every child goes into this process group so one signal reaches all of them.
pids=()

shutdown() {
  trap - INT TERM EXIT
  echo
  echo "stopping…"
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM EXIT

start() {
  local name=$1; shift
  printf '  %-10s %s\n' "$name" "$*"
  "$@" 2>&1 | sed "s/^/[$name] /" &
  pids+=($!)
}

# Whether this run wants a given process.
#
# Reads $@ directly rather than taking the request list as arguments. The
# argument-passing version of this was subtly broken for a year: `want engine
# "${requested[@]:-}"` on an *empty* array expands to one empty-string argument
# rather than none, so the `[ $# -eq 0 ]` "no arguments means everything" branch
# was unreachable and a bare `./start.sh` printed its banner and started nothing.
want() {
  [ $# -eq 0 ] && return 1     # called wrong; fail loudly rather than silently
  [ ${#REQUESTED[@]} -eq 0 ] && return 0
  local arg
  for arg in "${REQUESTED[@]}"; do [ "$arg" = "$1" ] && return 0; done
  return 1
}

REQUESTED=("$@")

# A typo'd name used to start nothing and say nothing. Checked against the real
# list so `./start.sh coutroom` is a message rather than a silent no-op.
KNOWN=(engine courtroom classroom lms)
for arg in "${REQUESTED[@]:-}"; do
  [ -z "$arg" ] && continue
  found=no
  for known in "${KNOWN[@]}"; do [ "$arg" = "$known" ] && found=yes; done
  if [ "$found" = no ]; then
    echo "Unknown process: $arg" >&2
    echo "Pick from: ${KNOWN[*]}  (or pass nothing for all four)" >&2
    trap - INT TERM EXIT
    exit 2
  fi
done

echo "converso-suite"

if want engine; then
  start engine npm start --workspace apps/courtroom-engine
  # The courtroom retries on a backoff if it connects first, so this is a
  # courtesy rather than a requirement.
  sleep 1
fi

want courtroom && start courtroom npm run dev --workspace apps/courtroom

# Both Next apps are `next dev`, which defaults to 3000, so whichever came up
# second used to silently take 3001 instead. That is not cosmetic: the LMS is the
# one you open and the one whose origin is baked into the courtroom's
# VITE_CONVERSO_URL, so letting it drift points both scenes at a server that is
# not there. Each app now pins its own port in its own package.json, which also
# holds for `npm run dev:classroom` and for running either app directly.
want classroom && start classroom npm run dev --workspace apps/classroom
want lms       && start lms       npm run dev --workspace apps/lms

echo
echo "  open http://localhost:3000    ·  Ctrl-C stops all of it"
echo

wait
