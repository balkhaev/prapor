#!/usr/bin/env sh
exec node "$(dirname "$0")/launch.cjs" "${1:-dev}"
