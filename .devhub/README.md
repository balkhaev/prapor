# Local development

Dev servers are owned by DevHub. Run the usual package dev command or `node .devhub/launch.cjs dev`; it asks DevHub to start the services in `devhub.json`. DevHub manages their lifecycle, dependencies, ports and logs. Set `DEVHUB_ROOT` when DevHub is outside a sibling `devhub` directory.

Edit raw commands, relative working directories, environment overrides and script groups in `devhub.json`. Do not replace package dev scripts with standalone process spawners. The first original commands are preserved in `original-scripts.json`.

Production uses this project's own build, start and deploy commands and requires no DevHub files, installation, checkout or API.
