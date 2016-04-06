if (Meteor.isServer) {
	UserIdLocker = Locker.makeUserIdLocker('user-id', 'convexset_locker__userId', 10);
	UserIdLocker.DEBUG_MODE = true;
	ConnectionIdLocker = Locker.makeConnectionIdLocker('user-id', 'convexset_locker__connectionId', 10);
	ConnectionIdLocker.DEBUG_MODE = true;

	Meteor.startup(function() {
		Meteor.users.remove({});
		_.times(5, function(idx) {
			Accounts.createUser({
				username: "user" + (idx + 1),
				email: "user" + (idx + 1) + "@he.re",
				password: "password",
			});
		});
	});

	function tester(name, locker) {
		return function() {
			var ret = {
				currMethodContext: locker.currMethodContext,
				currLockerId: locker.currLockerId
			};
			console.log('["test-user-id"]', ret);
			return ret;
		}
	}

	Meteor.methods({
		"release-all-locks": function() {
			UserIdLocker._releaseAllLocks();
			ConnectionIdLocker._releaseAllLocks();
		},
		"test-user-id": UserIdLocker.wrap(tester("test-user-id", UserIdLocker)),
		"test-connection-id": ConnectionIdLocker.wrap(tester("test-connection-id", ConnectionIdLocker)),
		"acquire-lock-user": UserIdLocker.wrap(function(name, metadata) {
			return UserIdLocker.acquireLock(name, metadata);
		}),
		"acquire-lock-connection": ConnectionIdLocker.wrap(function(name, metadata) {
			return ConnectionIdLocker.acquireLock(name, metadata);
		}),
		"release-lock-user": UserIdLocker.wrap(function(name) {
			return UserIdLocker.releaseLock(name);
		}),
		"release-lock-connection": ConnectionIdLocker.wrap(function(name) {
			return ConnectionIdLocker.releaseLock(name);
		}),
	})
}

if (Meteor.isClient) {
	var UserIdLockerCollection = new Mongo.Collection("convexset_locker__userId");
	var ConnectionIdLockerCollection = new Mongo.Collection("convexset_locker__connectionId");

	var connectionId = new ReactiveVar("-");
	Meteor.setInterval(function() {
		connectionId.set(Meteor.connection && Meteor.connection._lastSessionId || "-");
	}, 1000);
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
		['lockName', 'lockerId', '_id', 'expiryMarker'].forEach(function(key) {
			if (item.hasOwnProperty(key)) {
				delete item[key];
			}
		});
		return EJSON.stringify(item);
	});

	function reportResult(err, res) {
		if (typeof err !== "undefined") {
			console.log("Error:", err);
		}
		if (typeof res !== "undefined") {
			console.log("Result:", res);
		}
	}

	Template.LockerDemo.events({
		'click button.login': function(event, template) {
			var userName = event.target.getAttribute('data-username');
			Meteor.loginWithPassword(userName, "password", function(err, res) {
				if (!err) {
					console.info('Logged in as ' + userName + '.');
				}
			});
		},
		'click button.acquire-lock-user': function(event, template) {
			var lockName = $('input.lock-name').val();
			var lockMeta = $('input.lock-meta').val() ? {meta: $('input.lock-meta').val()} : {};
			Meteor.call("acquire-lock-user", lockName, lockMeta, reportResult);
		},
		'click button.acquire-lock-connection': function(event, template) {
			var lockName = $('input.lock-name').val();
			var lockMeta = $('input.lock-meta').val() ? {meta: $('input.lock-meta').val()} : {};
			Meteor.call("acquire-lock-connection", lockName, lockMeta, reportResult);
		},
		'click button.release-lock-user': function(event, template) {
			var lockName = $('input.lock-name').val();
			Meteor.call("release-lock-user", lockName, reportResult);
		},
		'click button.release-lock-connection': function(event, template) {
			var lockName = $('input.lock-name').val();
			Meteor.call("release-lock-connection", lockName, reportResult);
		},
		'click button.release-all': function(event, template) {
			var button = event.target;
			$(button).attr('disabled', true);
			Meteor.call("release-all-locks", function() {
				$(button).removeAttr('disabled');
			});
		},
	});

	Template.LockerDemo.onRendered(function() {
		Meteor.setTimeout(() => $($('.login')[0]).click(), 1000);
		Meteor.setTimeout(function() {
			Meteor.call("test-user-id", (err, ret) => console.log(err, ret));
		}, 2000);
	});

	Meteor.startup(function() {
		Meteor.call("test-connection-id", (err, ret) => console.log(err, ret));
	});
}