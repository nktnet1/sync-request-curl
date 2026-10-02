## Caveats

**sync-request-curl** was developed to improve performance with sending
synchronous requests in Node.js. It is also free from the
[sync-request](https://github.com/ForbesLindesay/sync-request) bug
which leaves an orphaned sync-rpc process, resulting in a [leaked handle being
detected in Jest](https://github.com/ForbesLindesay/sync-request/issues/129).

**sync-request-curl** was initially designed to work with UNIX-like systems for
UNSW students enrolled in [COMP1531 Software Engineering
Fundamentals](https://webcms3.cse.unsw.edu.au/COMP1531/23T2/outline). The
native distribution targets glibc- and musl-based Linux, Windows, and macOS on
the architectures listed in the compatibility section.

Please note that this library's primary goal is to simplify the learning of
JavaScript for novice programmers, hence its synchronous nature. However, we
recommend to always use an
[asynchronous alternative](https://blog.appsignal.com/2024/09/11/top-5-http-request-libraries-for-nodejs.html)
where possible.

### Authentication and HEAD payloads

Authentication usernames must not contain ASCII control characters (including
CR, LF, and DEL). Bearer tokens must use the RFC 6750 `b64token` syntax. Passwords
may contain CR/LF because libcurl encodes or hashes them, but cannot contain NUL.
The same username rules apply to percent-decoded proxy URL credentials.

HEAD requests with a payload cannot use negotiated origin or proxy authentication
(`any`, `digest`, `ntlm`, or `negotiate`). This combination is rejected before
network I/O, rather than returning an intermediate challenge as a successful
transfer or waiting for a HEAD response body that will never arrive. Omit the
payload to use negotiated authentication with HEAD, or use preemptive Basic or
Bearer authentication when supported by the server. This restriction also applies
to empty explicit payloads and multipart forms.

### Timeouts with authentication and transfer limits

`timeout` remains a response-header deadline across libcurl's internal
requests, including authentication retries. A new request reactivates the same
deadline; it does not receive a fresh timeout budget. Once response headers are
complete, body transfers are governed by `socketTimeout` and `overallTimeout`.

When transfer speed limits are enabled, `socketTimeout` allows bounded additional
time for local throttling. Each newly transferred byte earns at most its
configured transmission time as an inactivity allowance. Repeated progress
callbacks without new bytes do not extend the allowance, and completed uploads
no longer earn upload allowance while waiting for a response. A stalled transfer
still times out after its remaining allowance and inactivity budget expire.
`overallTimeout` includes both throttling and authentication and is never extended.
