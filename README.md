# Locker

A package for providing locking functionality in Meteor Methods. Mutual exclusion (mutex) locks are acquired by "users" on "resources" (actually strings), and this works fine with `this.unblock()` in Meteor Methods.

Unique "users" are derived from information about the current DDP connection. So typical use cases would have "user ids" being derived from:
 - the `userId`
 - the connection id
 - other information about the connection

As with mutexes that lock on abstract resources, nothing is stopping code from ignoring a failure to acquire a lock and proceed to use a resource anyway. However, since this package is a server-side package, there is a reasonable expectation that "civilized behaviour" can be ensured by the developer.

Have a look at the example app to see how to use the package.

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->


- [Install](#install)
- [Overview of Functionality](#overview-of-functionality)
- [Usage](#usage)
  - [Creating a "Locker"](#creating-a-locker)
  - [Working With Locks](#working-with-locks)
  - [Publications](#publications)
  - [Administrative Functions](#administrative-functions)
  - [Debug Mode](#debug-mode)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## Overview of Functionality

There is functionality to acquire a lock and hold on to it even after the Meteor method used to establish the lock terminates (`acquireLock`) and to release it later (`releaseLock`). There is functionality to wait for a lock, execute code once established, and release it once done in a Meteor method (`ifLockElse`).

**(NOTE: Due to the way Meteor processes methods, not calling `this.unblock()` in a method would result in the blocking of a client's subsequent Meteor method calls when `ifLockElse` is used to wait for a lock to be acquired.)**


## Install

This is available as [`convexset:locker`](https://atmospherejs.com/convexset/locker) on [Atmosphere](https://atmospherejs.com/). (Install with `meteor add convexset:locker`.)

If you get an error message like:
```
WARNING: npm peer requirements not installed:
 - package-utils@^0.2.1 not installed.
          
Read more about installing npm peer dependencies:
  http://guide.meteor.com/using-packages.html#peer-npm-dependencies
```
It is because, by design, the package does not include instances of these from `npm` to avoid repetition. (In this case, `meteor npm install --save package-utils` will deal with the problem.)

See [this](http://guide.meteor.com/using-packages.html#peer-npm-dependencies) or [this](https://atmospherejs.com/tmeasday/check-npm-versions) for more information.

Now, if you see a message like
```
WARNING: npm peer requirements not installed:
underscore@1.5.2 installed, underscore@^1.8.3 needed
```
it is because you or something you are using is using Meteor's cruddy old `underscore` package. Install a new version from `npm`. (And, of course, you may use the `npm` version in a given scope via `require("underscore")`.)


## Usage

### Creating a "Locker"

The first step is to decide what kinds of "users" of resources you have. One typical approach is to group things by `userId` so only a single user may have access to a "resource" at a time (e.g. being on a route where a document may be edited). Another approach is to group things by the `connectionId` so only a user may only access a "resource" from a single window at a time.

Functionality to use the above two forms are included in:
 - `LockerFactory.makeUserIdLocker(name, collectionName, defaultExpiryInSec)`: Locking by user id
   * `name`: a name for the locker, used mostly for debugging purposes (default: `"user-id"`)
   * `collectionName`: the name of the collection to be used (default: `"convexset_locker__userId"`)
   * `defaultExpiryInSec`: default time it takes for a lock to expire (in seconds) (default: `3600`)
 - `LockerFactory.makeConnectionIdLocker(name, collectionName, defaultExpiryInSec)`: Locking by connection (recommended)
   * `name`: a name for the locker, used mostly for debugging purposes (default: `"connection-id"`)
   * `collectionName`: the name of the collection to be used (default: `"convexset_locker__connectionId"`)
   * `defaultExpiryInSec`: default time it takes for a lock to expire (in seconds) (default: `3600`)

However, one may create locks where users are defined by things such as IP addresses or web browsers. To do that, one defines a function (a `contextToLockerIdFunction`) that takes, as argument, the current "locker context" within a Meteor Method, and derives an identifier from it. (The `contextToLockerIdFunction` should only return string's, null's or undefined's.)

Here is an example locker context:
```javascript
{
    isSimulation: false,
    _unblock: [Function],
    _calledUnblock: false,
    userId: 'dwtnMSyxqxi32yGKC',
    _setUserId: [Function],
    connection: {
        id: 'iE7w8mcJ2RGHATCLi',
        close: [Function],
        onClose: [Function],
        clientAddress: '127.0.0.1',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    },
    randomSeed: null,
    randomStream: null
}
```
(Hmmmm... This kinda looks like the `this` within a Meteor Method. What about the famous `unblock`? Don't worry. Its prototype looks like `{ unblock: [Function], setUserId: [Function] }`.)

But then again, maybe one need only care about this subset:
```javascript
{
    userId: 'dwtnMSyxqxi32yGKC',
    connection: {
        id: 'iE7w8mcJ2RGHATCLi',
        clientAddress: '127.0.0.1',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    }
}
```

The syntax for making a general locker is:

`LockerFactory.makeLocker(name, collectionName, contextToLockerIdFunction, defaultExpiryInSec = 3600)`

So it might be said that `LockerFactory.makeUserIdLocker` provides syntactic sugar for setting the `contextToLockerIdFunction` argument to `context => context && context.userId` and `LockerFactory.makeConnectionIdLocker` provides syntactic sugar for setting the `contextToLockerIdFunction` argument to `context => context && context.connection && context.connection.id`.

### Working With Locks

First and foremost, lock names are either of the following:
 - a non-empty string that may contain only alphanumeric characters as well as `"-"` and `"_"`.
 - a non-empty array of such strings

Now, given a locker `Locker`...
 -  `Locker.acquireLock(name, metadata, expiryInSec)`
   * `name`: the name of the lock to acquire (see [above](#working-with-locks) for naming guidelines)
   * `metadata`: metadata to include in lock record (default: `{}`)
     + may contain key-value pairs of strings comprising only alphanumeric characters as well as `"-"` and `"_"`
     + useful for use with `Locker._collection` (see [below](#administrative-functions))
     + the following keys will be ignored: `['lockName', 'lockerId', 'expiryMarker', 'userId', 'connectionId', '_id']`
   * `expiryInSec`: time to expiry of this lock; capped by the [defaults previously configured](#creating-a-locker) (default: `null`)
 - `Locker.releaseLock(name)`: releases the lock with name `name` (if it belongs to the current "user", as defined in the [configuration](#creating-a-locker); i.e.: possibly a Meteor user or a connection)
 - `Locker.ifLockElse(name, options)`: tries to acquire a lock with name `name` (see [above](#working-with-locks) for naming guidelines) and perform certain actions if successful and others if not, the following may be specified in the `options` object:
   * `metadata`: as above (default: `{}`)
   * `expiryInSec`: as above (default: `null`)
   * `lockAcquiredCallback`: a function with tasks to execute if the lock is successfully acquired (default: `function() {}`)
   * `lockNotAcquiredCallback`: a function with tasks to execute if the lock is not acquired (default: `function() {}`)
   * `context`: the calling context of the above functions, if it is a function, the result of calling it with no arguments will be used (default: `{}`)
   * `releaseOwnLock`: whether to call `Locker.releaseOwnLock(name)` (default: `false`)
   * `maxTrials`: maximum number of attempts to acquire the lock; if greater than 1, the Meteor method will be [unblocked](http://docs.meteor.com/#/full/method_unblock) (default: `1`)
   * `forceNoUnblock`: ensures that `ifLockElse` does not unblock the method (the developer can still do this elsewhere) (see the `maxTrials` parameter just above) (default: `false`)
   * `retryIntervalInMs`: the base interval (B) between retries in milliseconds (default: `1000`)
   * `retryIntervalLinearBackOffIncrementInMs`: the linear increment (L) for the retry time in milliseconds (default: `0`)
   * `retryIntervalExponentialBackOffExponentMultiplier`: the exponent (E) used to amplify the retry time *a la* [exponential back-off](https://en.wikipedia.org/wiki/Exponential_backoff) (default: `0`)
   * Note: the retry time interval may be expressed as `B exp(E(t-1)) + (t-1)L` where `t` is the number of unsuccessful attempts
 - `Locker.releaseOwnLock(name)`: release a lock with name `name` created by the same Meteor user (regardless of locker type; works even when locking by connection id)
 - `Locker.releaseAllOwnLocks()`: releases all locks created by the same Meteor user (regardless of locker type; works even when locking by connection id)
 - `Locker.releaseAllCurrentConnectionLocks()`: releases all locks created from the current connection (regardless of locker type)
 - `Locker.releaseAllOwnCurrentConnectionLocks()`: releases all locks created by the current Meteor user from the current connection (regardless of locker type)


### Publications

Before talking about publication functionality, it is useful to provide an example of a publication context which will be used for authentication and computing selectors for collection data.

Here is an example of a publication context (the `this` when a publication function is called during a subscription):
```javascript
{
    _session: { /* Don't Worry About This */ },
    connection: {
        id: 'ix35iGpY7TaX6p2Mr',
        close: [Function],
        onClose: [Function],
        clientAddress: '127.0.0.1',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    },
    _handler: [Function: publishLocks],
    _subscriptionId: 'FmqF9MdPaj9rEhgLN',
    _name: 'conn-id-locks',
    _params: [],
    _subscriptionHandle: 'NFmqF9MdPaj9rEhgLN',
    _deactivated: false,
    _stopCallbacks: [],
    _documents: {},
    _ready: false,
    userId: 'x9pnyfHjbK5c9u4Hz',
    _idFilter: {
        idStringify: [Function],
        idParse: [Function]
    }
}
```
... of course, this is perhaps the subset one should care about: 
```javascript
{
    connection: {
        id: 'ix35iGpY7TaX6p2Mr',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    },
    userId: 'x9pnyfHjbK5c9u4Hz'
}
```

Given a locker `Locker`...
 - `Locker.makePublication(name, selector, authFunction)`: make a generic publication with authentication
   * `name`: the name of the publication
   * `selector`: the selector on the lock collection; if a function is supplied, then it will be invoked with the publication context as its argument to generate the selector at subscription time (default: `{}`)
     - e.g.: selecting the locks associated with the current user, `context => ({userId: context && context.userId})`
     - e.g.: selecting the locks associated with the current connection, `context => ({connectionId: context && context.connection && context.connection.id})`
     - Note that the selector can be used to filter against metadata fields. For example, an "organization id" might be stored in a metadata field, and the selector can use user id information in the publication context to find the current user's organization id, and now an administrative panel for releasing locks at an "organization level" can be built
   * `authFunction`: a function testing whether a subscriber is authorized to subscribe to the publication, it will be invoked the publication context as an argument at subscription time (default: `() => true`)
 - `Locker.makeOwnLocksPublication(name, authFunction)`: publish locks 
   * `name`: the name of the publication
   * `authFunction`: a function testing whether a subscriber is authorized to subscribe to the publication, it will be invoked the publication context as an argument at subscription time (default: `() => true`)
 - `Locker.makeCurrConnectionLocksPublication(name, authFunction)`: 
   * `name`: the name of the publication
   * `authFunction`: a function testing whether a subscriber is authorized to subscribe to the publication, it will be invoked the publication context as an argument at subscription time (default: `() => true`)
 - `Locker.makeOwnCurrConnectionLocksPublication(name, authFunction)`: 
   * `name`: the name of the publication
   * `authFunction`: a function testing whether a subscriber is authorized to subscribe to the publication, it will be invoked the publication context as an argument at subscription time (default: `() => true`)

Given that one can publish lock records, one question that might arise is what a lock record might look like. Here are some examples (don't mind the serialized date):
```javascript
{
    "_id": "fWfHnwBLpKgKQqdiY",
    "lockName": "action-1:YvtKX",
    "lockerId": "PntbfdCAaSMTWjkmD",  // the userId for this Locker
    "expiryMarker": {
        "$date": 1460112131863
    },
    "userId": "PntbfdCAaSMTWjkmD",
    "connectionId": "TkKPTzP7XnvtjvbgC",
    "meta": "abcd",  // metadata field
    "beta": "efgh",  // metadata field
    "zeta": "ijlk"   // metadata field
}
```
At times, the `userId` field could be `null`, as it might also be possible (though unlikely) for the `connectionId` to also be `null`.
```javascript
{
    "_id": "smqHpsNRgu2ssWpkb",
    "lockName": "action-3:3PGT7",
    "lockerId": "wggzNHjQ8nbwYogk3",  // the connectionId for this Locker
    "expiryMarker": {
        "$date": 1460112206812
    },
    "userId": null,
    "connectionId": "wggzNHjQ8nbwYogk3",
    "meta": "lmno",  // metadata field
    "beta": "pqrs",  // metadata field
    "zeta": "tuvw"   // metadata field
}
```

### Administrative Functions

Given a locker `Locker`...
 - `Locker._collection`: returns the associated collection (try not to abuse this)
 - `Locker._releaseLockById(_id)`: releases a lock by it's document id in the above collection
 - `Locker._releaseAllLocks()`: releases all locks

### Debug Mode

Given a locker `Locker`...

To turn on debug mode, set
```
Locker.DEBUG_MODE = true;
```