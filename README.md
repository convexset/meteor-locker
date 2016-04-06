# Locker

A package for providing locking functionality for Meteor Methods. Mutual exclusion locks are acquired by "users" on "resources" (actually strings), and this works fine with `this.unblock()` in Meteor Methods.

Unique "users" are derived from information about the current DDP connection. So typical use cases would have "user ids" being derived from:
 - the `userId`
 - the connection id
 - other information about the connection

Have a look at the example app to see how to use the package.

## Table of Contents

- [Install](#install)
- [Usage](#usage)

## Install

This is available as [`convexset:locker`](https://atmospherejs.com/convexset/locker) on [Atmosphere](https://atmospherejs.com/). (Install with `meteor add convexset:locker`.)

## Usage

...

```javascript
INVALID_META_DATA_KEYS = ['lockName', 'lockerId', 'expiryMarker', 'userId', 'connectionId'];
```