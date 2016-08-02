/* global DDP: true */
/* global LockerFactory: true */

import { checkNpmVersions } from 'meteor/tmeasday:check-npm-versions';
checkNpmVersions({
  'package-utils': '^0.2.1',
  'underscore' : '^1.8.3',
});
const PackageUtilities = require('package-utils');
const _ = require('underscore');

import { Mongo } from 'meteor/mongo';


LockerFactory = (function() {
	var _lf = function LockerFactory() {};
	var LF = new _lf();

	PackageUtilities.addImmutablePropertyFunction(LF, "makeLocker", makeLocker);
	PackageUtilities.addImmutablePropertyFunction(LF, "makeUserIdLocker", function makeUserIdLocker(name = 'user-id', collectionName = 'convexset_locker__userId', defaultExpiryInSec = 3600) {
		return makeLocker(name, collectionName, context => context && context.userId, defaultExpiryInSec);
	});
	PackageUtilities.addImmutablePropertyFunction(LF, "makeConnectionIdLocker", function makeConnectionIdLocker(name = 'connection-id', collectionName = 'convexset_locker__connectionId', defaultExpiryInSec = 3600) {
		return makeLocker(name, collectionName, context => context && context.connection && context.connection.id, defaultExpiryInSec);
	});

	return LF;
}());

function makeLocker(name, collectionName, contextToLockerIdFunction, defaultExpiryInSec = 3600) {
	var _l = function Locker() {};
	var L = new _l();

	//////////////////////////////////////////////////////////////////////
	// Debug Mode
	//////////////////////////////////////////////////////////////////////
	var _debugMode = false;
	PackageUtilities.addPropertyGetterAndSetter(L, "DEBUG_MODE", {
		get: () => _debugMode,
		set: (value) => {
			_debugMode = !!value;
		},
	});

	function LOG(...args) {
		if (_debugMode) {
			console.log.apply(console, ['[Locker|' + name + ']'].concat(args));
		}
	}

	function INFO(...args) {
		if (_debugMode) {
			console.info.apply(console, ['[Locker|' + name + ']'].concat(args));
		}
	}

	function WARN(...args) {
		if (_debugMode) {
			console.warn.apply(console, ['[Locker|' + name + ']'].concat(args));
		}
	}

	function ERROR(...args) {
		if (_debugMode) {
			console.error.apply(console, ['[Locker|' + name + ']'].concat(args));
		}
	}
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// collection stuff
	//////////////////////////////////////////////////////////////////////
	var collection = new Mongo.Collection(collectionName);
	collection._ensureIndex({
		expiryMarker: 1
	}, {
		expireAfterSeconds: defaultExpiryInSec
	});
	collection._ensureIndex({
		lockName: 1
	}, {
		unique: true
	});
	PackageUtilities.addImmutablePropertyValue(L, "_collection", collection);
	INFO("Preparing collection...");
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// getLockerId via context
	//////////////////////////////////////////////////////////////////////
	function getContext() {
		// https://github.com/meteor/meteor/blob/abd574f38008b45f5e2a6bc322b10bcdde44763a/packages/meteor/dynamics_nodejs.js
		// https://github.com/meteor/meteor/blob/be986fd70926c9dd8eff6d8866205f236c8562c4/packages/ddp-server/livedata_server.js#L709
		var context = DDP._CurrentInvocation.getOrNullIfOutsideFiber();
		if (!!context) {
			return context;
		} else {
			ERROR('[invalid-calling-context] Context only available within a Fiber. (e.g.: within Meteor Method invocations.)');
			throw new Meteor.Error('invalid-calling-context', 'Context only available within a Fiber. (e.g.: within Meteor Method invocations.)');
		}
	}
	PackageUtilities.addPropertyGetter(L, "lockerContext", getContext);

	PackageUtilities.addImmutablePropertyFunction(L, "getUserIdAndConnectionId", function getUserIdAndConnectionId() {
		var context = getContext();
		return {
			userId: context && context.userId,
			connectionId: context && context.connection && context.connection.id
		};
	});

	PackageUtilities.addImmutablePropertyFunction(L, "getLockerId", function getLockerId() {
		var lockerId = contextToLockerIdFunction(getContext());
		if ((lockerId !== null) && (typeof lockerId !== "undefined") && (typeof lockerId !== "string")) {
			throw new Meteor.Error('invalid-locker-id', 'contextToLockerIdFunction should only return strings, null\'s or undefined\'s.');
		}

		if (!!lockerId) {
			return lockerId;
		} else {
			ERROR('[invalid-locker-id] Blank, null, undefined or otherwise falsey lockerIds forbidden.');
			throw new Meteor.Error('invalid-locker-id', 'Blank, null, undefined or otherwise falsey lockerIds forbidden.');
		}
	});
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// Lock Name Stuff
	//////////////////////////////////////////////////////////////////////
	var ALPHA_NUMERIC_PLUS = [].concat(_.range(48, 48 + 10), _.range(65, 65 + 26), _.range(97, 97 + 26)).map(x => String.fromCharCode(x)).concat(["_", "-"]).join("");

	function isValidLockNameEntry(name) {
		for (var i = 0; i < name.length; i++) {
			if (ALPHA_NUMERIC_PLUS.indexOf(name[i]) === -1) {
				return false;
			}
		}
		return true;
	}

	function toLockName(name) {
		if (typeof name === "string") {
			if (name === "") {
				ERROR('[invalid-lock-name] Empty strings not allowed.');
				throw new Meteor.Error('invalid-lock-name', 'Empty strings not allowed.');
			}
			if (!isValidLockNameEntry(name)) {
				ERROR('[invalid-lock-name] Only alpha-numeric characters, underscores and dashes allowed.');
				throw new Meteor.Error('invalid-lock-name', 'Only alpha-numeric characters, underscores and dashes allowed.');
			}
			return name;
		}
		if (_.isArray(name)) {
			name.forEach(function(nameComponent) {
				if (!isValidLockNameEntry(nameComponent)) {
					ERROR('[invalid-lock-name-component] Only alpha-numeric characters, underscores and dashes allowed.');
					throw new Meteor.Error('invalid-lock-name-component', 'Only alpha-numeric characters, underscores and dashes allowed.');
				}
			});
			return name.join(':');
		}
		ERROR('[invalid-lock-name] Only strings containing alpha-numeric characters, underscores and dashes or arrays of such strings allowed.');
		throw new Meteor.Error('invalid-lock-name');
	}
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// Locking Stuff Proper
	//////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(L, "releaseLock", function releaseLock(name) {
		name = toLockName(name);
		var currLockerId = L.getLockerId();
		LOG('[releaseLock|' + currLockerId + '] Lock Name: ' + name);
		return !!collection.remove({
			lockName: name,
			lockerId: currLockerId
		});
	});

	var INVALID_META_DATA_KEYS = ['_id', 'lockName', 'lockerId', 'expiryMarker', 'userId', 'connectionId'];

	PackageUtilities.addImmutablePropertyFunction(L, "acquireLock", function acquireLock(name, metadata = {}, expiryInSec = null) {
		name = toLockName(name);
		var currLockerId = L.getLockerId();
		LOG('[acquireLock|' + currLockerId + '] Lock Name: ' + name, "; Metadata:", metadata, "; expiryInSec:", expiryInSec);
		if (typeof metadata !== "object") {
			throw new Meteor.Error('metadata-should-be-an-object');
		}
		if ((typeof expiryInSec !== "number") || !Number.isFinite(expiryInSec) || (expiryInSec > defaultExpiryInSec)) {
			expiryInSec = defaultExpiryInSec;
		}
		var expiryMarker = new Date((new Date()).getTime() - (defaultExpiryInSec - expiryInSec) * 1000);

		if (typeof metadata !== "object") {
			ERROR('[invalid-argument] metadata should be an object:', metadata);
			throw new Meteor.Error('invalid-argument', 'metadata should be an object');
		}
		INVALID_META_DATA_KEYS.forEach(function(key) {
			if (metadata.hasOwnProperty(key)) {
				WARN('[metadata-with-invalid-field] ' + key);
				delete metadata[key];
			}
		});
		Object.keys(metadata).forEach(function(key) {
			if (!isValidLockNameEntry(key)) {
				ERROR('[invalid-argument] Invalid key in metadata:', key);
				throw new Meteor.Error('invalid-argument', 'metadata keys should only contain alphanumeric characters, \"-\" and \"_\".');
			}
			if (!isValidLockNameEntry(metadata[key])) {
				ERROR('[invalid-argument] Invalid value in metadata[' + key + ']:', metadata[key]);
				throw new Meteor.Error('invalid-argument', 'metadata values should only contain alphanumeric characters, \"-\" and \"_\".');
			}
		});

		var updater = _.extend({
			expiryMarker: expiryMarker,
		}, L.getUserIdAndConnectionId(), metadata);

		var ret;
		try {
			ret = collection.upsert({
				lockName: name,
				lockerId: currLockerId
			}, {
				$set: updater
			});
		} catch (e) {
			if (e.name === 'MongoError' && e.code === 11000) {
				WARN('[failed-to-acquire-lock] lockName=' + name + ', lockerId: ' + currLockerId);
				throw new Meteor.Error('failed-to-acquire-lock');
			} else {
				throw e;
			}
		}
		return (!!ret && !!ret.numberAffected);
	});

	PackageUtilities.addImmutablePropertyFunction(L, "ifLockElse", function ifLockElse(name, options) {
		options = _.extend({
			metadata: {},
			expiryInSec: null,
			lockAcquiredCallback: function() {},
			lockNotAcquiredCallback: function() {},
			context: {},
			releaseOwnLock: false,
			maxTrials: 1,
			forceNoUnblock: false,
			retryIntervalInMs: 1000,
			retryIntervalLinearBackOffIncrementInMs: 0,
			retryIntervalExponentialBackOffExponentMultiplier: 0,
		}, options);

		LOG('[ifLockElse|' + L.getLockerId() + '] Lock Name: ' + name, '; Options:', options);

		if (options.maxTrials < 1) {
			throw new Meteor.Error('invalid-argument', 'options.maxTrials');
		}

		var mostRecentTrial = 0;
		try {
			if (options.releaseOwnLock) {
				// might be locked by connection...
				LOG('[ifLockElse|' + L.getLockerId() + '] Releasing own locks (locks on ' + name + ' by the current user)');
				L.releaseOwnLock(name);
			}
			if (options.maxTrials > 1) {
				if (forceNoUnblock) {
					LOG(`[ifLockElse|${L.getLockerId()}] options.maxTrials (${options.maxTrials}) > 1... but not calling context.unblock() since forceNoUnblock=${forceNoUnblock}`);
				} else {
					LOG(`[ifLockElse|${L.getLockerId()}] Calling context.unblock() since options.maxTrials=${options.maxTrials} > 1...`);
					getContext().unblock();
				}
			}
			while (mostRecentTrial < options.maxTrials) {
				try {
					mostRecentTrial += 1;
					L.acquireLock(name, options.metadata, options.expiryInSec);
					break;
				} catch (e) {
					if (mostRecentTrial < options.maxTrials) {
						var expBackOffMul = Math.exp(Math.max(0, Math.min(700, (mostRecentTrial - 1) * options.retryIntervalExponentialBackOffExponentMultiplier)));
						var nextRetryIntervalInMs = Math.floor((options.retryIntervalInMs * expBackOffMul) + (mostRecentTrial - 1) * options.retryIntervalLinearBackOffIncrementInMs);
						WARN('[ifLockElse|' + L.getLockerId() + '] Failed to acquire lock on ' + name + ' (trial ' + mostRecentTrial + '). Trying again in ' + nextRetryIntervalInMs + 'ms. (Max Trials: ' + options.maxTrials + ')');
						Meteor._sleepForMs(nextRetryIntervalInMs);
						WARN('[ifLockElse|' + L.getLockerId() + '] Retrying...');
					} else {
						ERROR('[ifLockElse|' + L.getLockerId() + '] Failed to acquire lock on ' + name + ' (trial ' + mostRecentTrial + '). Giving up. (Max Trials: ' + options.maxTrials + ')');
						throw e;
					}
				}
			}
			var ret = {
				lockAcquired: true,
				outcome: options.lockAcquiredCallback.call(
					_.isFunction(options.context) ? options.context() : options.context
				)
			};
			L.releaseLock(name);
			return ret;
		} catch (e) {
			return {
				lockAcquired: false,
				outcome: options.lockNotAcquiredCallback.call(
					_.isFunction(options.context) ? options.context() : options.context
				)
			};
		}
	});
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// Other Lock Release Tools
	//////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(L, "releaseOwnLock", function releaseOwnLock(name) {
		name = toLockName(name);
		LOG('[releaseOwnLock] ' + name);
		return !!collection.remove({
			lockName: name,
			userId: Meteor.userId()
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "releaseAllOwnLocks", function releaseAllOwnLocks() {
		LOG('[releaseAllOwnLocks]');
		return !!collection.remove({
			userId: Meteor.userId()
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "releaseAllCurrentConnectionLocks", function releaseAllCurrentConnectionLocks() {
		LOG('[releaseAllCurrentConnectionLocks]');
		var info = L.getUserIdAndConnectionId();
		return !!collection.remove({
			connectionId: info && info.connectionId
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "releaseAllOwnCurrentConnectionLocks", function releaseAllCurrentConnectionLocks() {
		LOG('[releaseAllOwnCurrentConnectionLocks]');
		return !!collection.remove(L.getUserIdAndConnectionId());
	});
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// Administrative Lock Release Tools
	//////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(L, "_releaseLockById", function _releaseLockById(_id) {
		LOG('[_releaseLockById] ' + _id);
		return !!collection.remove({
			_id: _id
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "_releaseAllLocks", function _releaseAllLocks() {
		LOG('[_releaseAllLocks]');
		return collection.remove({});
	});
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// Publications
	//////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(L, "makePublication", function makePublication(name, selector = {}, authFunction = () => true) {
		Meteor.publish(name, function publishLocks() {
			var _sel = _.isFunction(selector) ? selector(this) : selector;
			LOG('[Subscription to LocksPublication] ' + name, _sel, this);
			if (authFunction(this)) {
				return collection.find(_sel);
			} else {
				this.ready();
			}
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "makeOwnLocksPublication", function makeOwnLocksPublication(name, authFunction = () => true) {
		Meteor.publish(name, function publishOwnLocks() {
			LOG('[Subscription to OwnLocksPublication] ' + name, this);
			if (authFunction(this)) {
				return collection.find({
					userId: this.userId
				});
			} else {
				this.ready();
			}
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "makeCurrConnectionLocksPublication", function makeCurrConnectionLocksPublication(name, authFunction = () => true) {
		Meteor.publish(name, function publishCurrConnectionLocks() {
			LOG('[Subscription to CurrConnectionLocksPublication] ' + name, this);
			if (authFunction(this)) {
				return collection.find({
					connectionId: this && this.connection && this.connection.id
				});
			} else {
				this.ready();
			}
		});
	});

	PackageUtilities.addImmutablePropertyFunction(L, "makeOwnCurrConnectionLocksPublication", function makeOwnLocksPublication(name, authFunction = () => true) {
		Meteor.publish(name, function publishOwnCurrConnectionLocks() {
			LOG('[Subscription to OwnCurrConnectionLocksPublication] ' + name, this);
			if (authFunction(this)) {
				return collection.find({
					userId: this.userId,
					connectionId: this && this.connection && this.connection.id
				});
			} else {
				this.ready();
			}
		});
	});
	//////////////////////////////////////////////////////////////////////

	return L;
}