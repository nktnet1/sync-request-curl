## Caveats

See [sync-request](https://www.npmjs.com/package/sync-request) for the original documentation. Version 5 targets its observable Node.js API rather than every lower-level `then-request` / `http-basic` internal, and intentionally keeps transport-specific native details behind high-level request options. See [Differences from `sync-request`](#differences-from-sync-request) for the compatibility boundaries.

**sync-request-curl** was developed to improve performance with sending synchronous requests in NodeJS. It is also free from the sync-request bug which leaves an orphaned sync-rpc process, resulting in a [leaked handle being detected in Jest](https://github.com/ForbesLindesay/sync-request/issues/129).

**sync-request-curl** was designed to work with UNIX-like systems for UNSW students enrolled in [COMP1531 Software Engineering Fundamentals](https://webcms3.cse.unsw.edu.au/COMP1531/23T2/outline). The native distribution targets glibc- and musl-based Linux, Windows, and macOS on the architectures listed in the compatibility section.

Please note that this library's primary goal is to simplify the learning of JavaScript for novice programmers, hence its synchronous nature. However, we recommend to **always use an [asynchronous alternative](https://blog.appsignal.com/2024/09/11/top-5-http-request-libraries-for-nodejs.html)** where possible.
