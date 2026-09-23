# Native prebuilds

Release CI places one Node-API addon per supported platform in this directory.
The published `sync-request-curl` package ships these files directly, so npm
installation never runs a native build or a binary download script.
