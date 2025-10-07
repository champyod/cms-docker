#!/bin/bash

# Simple healthcheck for CMS services
# Checks if the web server is responding

if curl -f http://localhost:${CMS_CONTEST_LISTEN_PORT:-8888}/ >/dev/null 2>&1; then
    echo "CMS Contest Web Server is healthy"
    exit 0
else
    echo "CMS Contest Web Server is not responding"
    exit 1
fi
