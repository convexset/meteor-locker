/* global Random: true */
/* global LockerFactory: true */
/* global UserIdLocker: true */
/* global ConnectionIdLocker: true */
/* global SomeOtherCollection: true */

if (Meteor.isServer) {
	UserIdLocker = LockerFactory.makeUserIdLocker('user-id', 'convexset_locker__userId', 30);
	UserIdLocker.DEBUG_MODE = true;
	ConnectionIdLocker = LockerFactory.makeConnectionIdLocker('connection-id', 'convexset_locker__connectionId', 30);
	ConnectionIdLocker.DEBUG_MODE = true;

	SomeOtherCollection = new Meteor.Collection('other-thing');

	Meteor.startup(function() {
		Meteor.users.remove({});
		SomeOtherCollection.remove({});
		_.times(5, function(idx) {
			Accounts.createUser({
				username: "user" + (idx + 1),
				email: "user" + (idx + 1) + "@he.re",
				password: "password",
			});
		});
	});


	Meteor.methods({
		"release-all-locks": function() {
			console.log("Incidentally, this is UserIdLocker locker context:", UserIdLocker.lockerContext);
			console.log("... and, this is ConnectionIdLocker locker context:", ConnectionIdLocker.lockerContext);
			return [
				UserIdLocker._releaseAllLocks(),
				ConnectionIdLocker._releaseAllLocks()
			];
		},
		"release-all-own-locks": function() {
			console.log("Incidentally, this is UserIdLocker locker context:", UserIdLocker.lockerContext);
			console.log("... and, this is ConnectionIdLocker locker context:", ConnectionIdLocker.lockerContext);
			return [
				UserIdLocker.releaseAllOwnLocks(),
				ConnectionIdLocker.releaseAllOwnLocks()
			];
		},
		"release-own-lock-connection": function(name) {
			return ConnectionIdLocker._releaseOwnLock(name);
		},
		"acquire-lock-user": function(name, metadata) {
			return UserIdLocker.acquireLock(name, metadata);
		},
		"acquire-lock-connection": function(name, metadata) {
			return ConnectionIdLocker.acquireLock(name, metadata);
		},
		"release-lock-user": function(name) {
			return UserIdLocker.releaseLock(name);
		},
		"release-lock-connection": function(name) {
			return ConnectionIdLocker.releaseLock(name);
		},
		"one-at-a-time-method-connection": function() {
			this.unblock();
			return ConnectionIdLocker.ifLockElse('this-thing', {
				context: null,
				maxTrials: 20,
				retryIntervalInMs: 250,
				retryIntervalLinearBackOffIncrementInMs: 250,
				retryIntervalExponentialBackOffExponentMultiplier: 0.25,
				releaseOwnLock: false,
				lockAcquiredCallback: function() {
					console.log('Lock acquired. Locker ID: ' + ConnectionIdLocker.getLockerId());
					var methodId = Random.id(20);
					var ids = [];
					_.times(2000, function(idx) {
						ids.push(SomeOtherCollection.insert({
							methodId: methodId,
							idx: idx,
							type: Random.choice(_.range(1000))
						}));
						if (idx + 1 === 1000) {
							console.log('[this-thing] Part A 1/2 done. Locker ID: ' + ConnectionIdLocker.getLockerId());
						}
						if (idx + 1 === 2000) {
							console.log('[this-thing] Part A done. Locker ID: ' + ConnectionIdLocker.getLockerId());
						}
					});
					_.times(1000, function(type) {
						SomeOtherCollection.update({
							methodId: methodId,
							type: type
						}, {
							$set: {
								x: Math.random()
							}
						});
					});
					console.log('[this-thing] Part B done. Locker ID: ' + ConnectionIdLocker.getLockerId());
					_.times(1000, function(type) {
						SomeOtherCollection.remove({
							methodId: methodId,
							type: type
						});
					});
					console.log('[this-thing] Part C done. All done. Locker ID: ' + ConnectionIdLocker.getLockerId());
					return "all done";
				},
				lockNotAcquiredCallback: function() {
					console.log('Failed to acquire lock. Locker ID: ' + ConnectionIdLocker.getLockerId());
					return "sadness... nothing got done...";
				},
			});
		},
	});
}

if (Meteor.isClient) {
	UserIdLockerCollection = new Mongo.Collection("convexset_locker__userId");
	ConnectionIdLockerCollection = new Mongo.Collection("convexset_locker__connectionId");

	var connectionId = new ReactiveVar("-");
	var lastResult = new ReactiveVar("");
	var lastError = new ReactiveVar("");
	Meteor.setInterval(function() {
		connectionId.set(Meteor.connection && Meteor.connection._lastSessionId || "-");
	}, 200);
	Template.registerHelper('lastResult', () => lastResult.get());
	Template.registerHelper('lastError', () => lastError.get());
	Template.registerHelper('CurrentUser', () => (Meteor.user() || {
		_id: "-",
		username: "-"
	}));
	Template.registerHelper('MeteorUsers', () => Meteor.users.find({}, {
		sort: {
			username: 1
		}
	}));
	Template.registerHelper('ConnectionId', () => connectionId.get());

	Template.registerHelper('AllLockData', () => [{
		name: "User Id Locks",
		data: UserIdLockerCollection.find({}, {
			sort: {
				lockName: 1
			}
		})
	}, {
		name: "Connection Id Locks",
		data: ConnectionIdLockerCollection.find({}, {
			sort: {
				lockName: 1
			}
		})
	}]);

	Template.registerHelper('showMetadata', function(item) {
		['_id', 'lockName', 'lockerId', 'userId', 'connectionId', 'expiryMarker'].forEach(function(key) {
			if (item.hasOwnProperty(key)) {
				delete item[key];
			}
		});
		return EJSON.stringify(item);
	});

	var reportResult = function reportResult(err, res) {
		if (typeof err !== "undefined") {
			console.log("Error:", err);
			lastError.set(EJSON.stringify(err, {
				canonical: true
			}));
			lastResult.set("");
		}
		if (typeof res !== "undefined") {
			console.log("Result:", res);
			lastResult.set(EJSON.stringify(res, {
				canonical: true
			}));
			lastError.set("");
		}
	};

	var getLockName = function getLockName() {
		var lockName1 = $('input.lock-name-1').val().trim();
		var lockName2 = $('input.lock-name-2').val().trim();
		if (!!lockName1 && !!lockName2) {
			return [lockName1, lockName2];
		}
		if (!!lockName1) {
			return lockName1;
		}
		return lockName2;
	};

	Template.LockerDemo.events({
		'click button.login': function(event) {
			var username = event.target.getAttribute('data-username');
			console.info('Signing in as ' + username + '...');
			Meteor.loginWithPassword(username, "password", function(err) {
				if (!err) {
					console.info('Logged in as ' + username + '.');
				}
			});
		},
		'click button.acquire-lock-user': function() {
			var lockName = getLockName();
			var lockMeta = $('input.lock-meta').val() ? {
				meta: $('input.lock-meta').val()
			} : {};
			Meteor.call("acquire-lock-user", lockName, lockMeta, reportResult);
		},
		'click button.acquire-lock-connection': function() {
			var lockName = getLockName();
			var lockMeta = $('input.lock-meta').val() ? {
				meta: $('input.lock-meta').val()
			} : {};
			Meteor.call("acquire-lock-connection", lockName, lockMeta, reportResult);
		},
		'click button.release-lock-user': function() {
			var lockName = getLockName();
			Meteor.call("release-lock-user", lockName, reportResult);
		},
		'click button.release-lock-connection': function() {
			var lockName = getLockName();
			Meteor.call("release-lock-connection", lockName, reportResult);
		},
		'click button.release-own-lock-connection': function() {
			var lockName = getLockName();
			Meteor.call("release-own-lock-connection", lockName, reportResult);
		},
		'click button.release-all': function() {
			Meteor.call("release-all-locks", reportResult);
		},
		'click button.release-all-own': function() {
			Meteor.call("release-all-own-locks", reportResult);
		},
		'click button.one-at-a-time-method-connection': function(event) {
			$(event.target).attr('disabled', true);
			Meteor.call("one-at-a-time-method-connection", function(err, res) {
				reportResult(err, res);
				$(event.target).removeAttr('disabled');
			});
		}
	});

	Template.LockerDemo.onRendered(function() {
		Meteor.setTimeout(() => $($('.login')[Math.floor(5 * Math.random())]).click(), 1000);
		$('input.lock-name-1').val(Random.choice(_.range(1,6).map(x => 'action-' + x)));
		$('input.lock-name-2').val(Random.id(5));
		$('input.lock-meta').val(Random.id(5));
	});
}