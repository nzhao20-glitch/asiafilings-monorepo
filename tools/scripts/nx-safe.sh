#!/usr/bin/env bash
set -euo pipefail

# Use this wrapper in sandboxed environments where Nx daemon/plugin sockets are blocked.
exec env NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx "$@"
