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
CR, LF, and DEL). Basic, Digest, and Any authentication also reject colons in
usernames and ASCII control characters in passwords. NTLM and Negotiate
passwords may contain CR/LF, but no authentication method accepts NUL in a
password. Bearer tokens must use the RFC 6750 `b64token` syntax. These rules also
apply to percent-decoded HTTP(S) proxy URL credentials; SOCKS usernames must
not contain ASCII controls, and SOCKS passwords must not contain NUL. Origin URL
credentials are percent-decoded and checked using the Basic authentication rules.
An explicit `Authorization` header takes precedence over origin URL credentials,
which are removed before transport so they cannot become active when a redirect
drops the header. `auth` cannot be combined with origin URL credentials or an
explicit `Authorization` header.

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
deadline; it does not receive a fresh timeout budget. Draining an intermediate
authentication response, including an accepted empty upload probe, still counts
towards this deadline. Only terminal response bodies (including a final 401/407)
are governed by `socketTimeout` and `overallTimeout` instead.

The native transport tracks outgoing request boundaries separately from received
header text, so accepted Digest probes do not discard validation of earlier
responses or permit forged status lines in trailers. Pending-body detection uses
libcurl's `Ignoring the response-body` diagnostic notification without logging or
retaining debug data. Custom/system builds with verbose strings disabled cannot
provide this signal: negotiated authentication with a positive `timeout` fails
explicitly with libcurl error 4 rather than silently losing timeout protection.
Use the bundled libcurl build for this combination. Changes to libcurl diagnostic
notifications must be verified against the authentication regression tests.

When transfer speed limits are enabled, `socketTimeout` allows bounded additional
time for local throttling. Each newly transferred byte earns at most its
configured transmission time as an inactivity allowance. Repeated progress
callbacks without new bytes do not extend the allowance. Reaching the final
upload byte preserves the allowance already earned, including that final burst:
libcurl can still pause for its upload rate limit before reading the response.
Without further progress, this allowance expires normally; a server that never
responds still times out after the remaining allowance and inactivity budget expire.
`overallTimeout` includes both throttling and authentication and is never extended.


### Proxy request headers

`proxy.headers` cannot supply `Content-Length` or `Transfer-Encoding`, including
explicit empty values. Body framing is managed by the request implementation;
non-tunnelled HTTP proxy requests combine the origin and proxy header lists.
`proxy.headers` also rejects `Authorization` and `Cookie`; these origin-sensitive
headers belong in the main request headers. `Proxy-Authorization` cannot be
combined with proxy URL credentials, `proxy.username`, `proxy.password`, or
`proxy.auth`. Both the public API and the native entry point reject these
combinations and framing overrides before network I/O. Other proxy headers retain
ordinary header validation.
