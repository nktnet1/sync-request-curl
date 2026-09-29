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
