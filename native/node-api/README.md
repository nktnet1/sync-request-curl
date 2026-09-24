# Node-API headers

These four headers are copied from the Node.js v22.16.0 distribution and are
used only when compiling the addon. The addon targets `NAPI_VERSION=8`, so the
resulting binary uses the stable Node-API ABI rather than the Node/V8 ABI.

Keeping the small C API header set in-tree makes release builds independent of
where a particular Node.js installation puts development headers, especially on
Windows. The headers remain licensed under the Node.js MIT license in `LICENSE`.
