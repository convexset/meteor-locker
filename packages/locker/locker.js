/* global Locker: true */
/* global PackageUtilities: true */
/* global Npm: true */

var Fiber = Npm.require('fibers');
	
Locker = (function() {
	var _lf = function LockerFactory() {};
	var LF = new _lf();

	PackageUtilities.addImmutablePropertyFunction(LF, "makeLocker", makeLocker);
	PackageUtilities.addImmutablePropertyFunction(LF, "makeUserIdLocker", function makeUserIdLocker(name = 'user-id', collectionName = 'convexset_locker__userId', defaultExpiryInSec = 3600) {
		return makeLocker(name, collectionName, context => context.userId, defaultExpiryInSec);
	});
	PackageUtilities.addImmutablePropertyFunction(LF, "makeConnectionIdLocker", function makeConnectionIdLocker(name = 'connection-id', collectionName = 'convexset_locker__connectionId', defaultExpiryInSec = 3600) {
		return makeLocker(name, collectionName, context => context.connection && context.connection.id, defaultExpiryInSec);
	});
	PackageUtilities.addImmutablePropertyFunction(LF, "makeLocker", makeLocker);

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
		var context = DDP._CurrentInvocation.getOrNullIfOutsideFiber();
		if (!!context) {
			return context;
		} else {
			ERROR('[invalid-calling-context] Context only available within a Fiber. (e.g.: within Meteor Method invocations.)');
			throw new Meteor.Error('invalid-calling-context', 'Context only available within a Fiber. (e.g.: within Meteor Method invocations.)');
		}
	}

	PackageUtilities.addImmutablePropertyFunction(L, "getLockerId", function getLockerId() {
		var lockerId = contextToLockerIdFunction(getContext());
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
		LOG('[releaseLock|' + currLockerId + '] ' + name);
		return !!collection.remove({
			lockName: name,
			lockerId: currLockerId
		});
	});

	var INVALID_META_DATA_KEYS = ['lockName', 'lockerId', 'expiryMarker', 'userId', 'connectionId'];

	PackageUtilities.addImmutablePropertyFunction(L, "acquireLock", function acquireLock(name, metadata = {}, expiryInSec = null) {
		name = toLockName(name);
		var currLockerId = L.getLockerId();
		LOG('[acquireLock|' + currLockerId + '] ' + name, metadata, expiryInSec);
		if (typeof metadata !== "object") {
			throw new Meteor.Error('metadata-should-be-an-object');
		}
		if ((typeof expiryInSec !== "number") || !Number.isFinite(expiryInSec) || (expiryInSec > defaultExpiryInSec)) {
			expiryInSec = defaultExpiryInSec;
		}
		var expiryMarker = new Date((new Date()).getTime() - (defaultExpiryInSec - expiryInSec) * 1000);

		INVALID_META_DATA_KEYS.forEach(function(key) {
			if (metadata.hasOwnProperty(key)) {
				WARN('[metadata-with-invalid-field] ' + key);
				delete metadata[key];
			}
		});

		var context = getContext();
		var updater = _.extend({
			expiryMarker: expiryMarker,
			userId: context && context.userId,
			connectionId: context && context.connection && context.connection.id
		}, metadata);

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
			context: this,
			releaseOwnLock: false,
		}, options);
		LOG('[ifLockElse|' + L.getLockerId() + '] ' + name, options);
		try {
			if (options.releaseOwnLock) {
				// might be locked by connection...
				L._releaseOwnLock(name);
			}
			L.acquireLock(name, options.metadata, options.expiryInSec);
			var ret = {
				lockAcquired: true,
				outcome: options.lockAcquiredCallback.call(options.context)
			};
			L.releaseLock(name);
			return ret;
		} catch(e) {
			return {
				lockAcquired: false,
				outcome: options.lockNotAcquiredCallback.call(options.context)
			};
		};
	});	
	//////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////
	// Other Lock Release Tools
	//////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(L, "_releaseOwnLock", function _releaseOwnLock(name) {
		name = toLockName(name);
		LOG('[_releaseOwnLock] ' + name);
		return !!collection.remove({
			lockName: name,
			userId: Meteor.userId()
		});
	});

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

	return L;
}