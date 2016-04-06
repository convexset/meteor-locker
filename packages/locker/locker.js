/* global Locker: true */
/* global PackageUtilities: true */

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


	// Debug Mode
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


	// collection stuff
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


	// do some dynamic scoping stuff
	var _currMethodContext = null;
	var _currLockerId = null;
	PackageUtilities.addImmutablePropertyFunction(L, "wrap", function wrap(fn) {
		return function() {
			_currMethodContext = this;
			_currLockerId = contextToLockerIdFunction(_currMethodContext);
			INFO("Current Method Context:", _currMethodContext);
			INFO("Current Locker Id:", _currLockerId);
			var args = _.toArray(arguments);
			var ret = fn.apply(this, args);
			_currMethodContext = null;
			_currLockerId = null;
			return ret;
		};
	});
	PackageUtilities.addPropertyGetter(L, "currMethodContext", () => _currMethodContext);
	PackageUtilities.addPropertyGetter(L, "currLockerId", () => _currLockerId);


	// Lock Name Stuff
	var ALPHA_NUMERIC_PLUS = [].concat(_.range(48,48+10), _.range(65,65+26), _.range(97,97+26)).map(x => String.fromCharCode(x)).concat(["_", "-"]).join("");
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
				throw new Meteor.Error('invalid-lock-name', 'Empty strings not allowed.');
			}
			if (!isValidLockNameEntry(name)) {
				throw new Meteor.Error('invalid-lock-name', 'Only alpha-numeric characters, underscores and dashes allowed.');
			}
			return name;
		}
		if (_.isArray(name)) {
			name.forEach(function(nameComponent) {
				if (!isValidLockNameEntry(nameComponent)) {
					throw new Meteor.Error('invalid-lock-name-component', 'Only alpha-numeric characters, underscores and dashes allowed.');
				}
			});
			return name.join(':');
		}
		throw new Meteor.Error('invalid-lock-name');
	}


	// Locking Stuff Proper
	PackageUtilities.addImmutablePropertyFunction(L, "releaseLock", function releaseLock(name) {
		name = toLockName(name);
		if (!_currLockerId) {
			throw new Meteor.Error('locker-id-undefined', 'Is your Meteor Method \"wrap\"\'ed?');
		}

		return !!collection.remove({
			lockName: name,
			lockerId: _currLockerId
		});
	});
	var INVALID_META_DATA_KEYS = ['lockName', 'lockerId', 'expiryMarker'];
	PackageUtilities.addImmutablePropertyFunction(L, "acquireLock", function acquireLock(name, metadata = {}, expiryInSec = null) {
		name = toLockName(name);
		if (!_currLockerId) {
			throw new Meteor.Error('locker-id-undefined', 'Is your Meteor Method \"wrap\"\'ed?');
		}
		if (typeof metadata !== "object") {
			throw new Meteor.Error('metadata-should-be-an-object');
		}
		if ((typeof expiryInSec !== "number") || !Number.isFinite(expiryInSec) || (expiryInSec > defaultExpiryInSec)) {
			expiryInSec = defaultExpiryInSec;
		}
		var expiryMarker = new Date((new Date()).getTime() - (defaultExpiryInSec - expiryInSec) * 1000)

		INVALID_META_DATA_KEYS.forEach(function(key) {
			if (metadata.hasOwnProperty(key)) {
				delete metadata[key];
			}
		});

		var updater = _.extend({
			expiryMarker: expiryMarker
		}, metadata);

		var ret;
		try {
			ret = collection.upsert({
				lockName: name,
				lockerId: _currLockerId
			}, {
				$set: updater
			});
		} catch (e) {
			if (e.name === 'MongoError' && e.code === 11000) {
				throw new Meteor.Error('failed-to-acquire-lock');
			} else {
				throw e;
			}
		}
		return (!!ret && !!ret.numberAffected);
	});
	PackageUtilities.addImmutablePropertyFunction(L, "_releaseLockById", function _releaseLockById(_id) {
		return !!collection.remove({
			_id: _id
		});
	});
	PackageUtilities.addImmutablePropertyFunction(L, "_releaseAllLocks", function _releaseAllLocks() {
		return collection.remove({});
	});

	return L;
};