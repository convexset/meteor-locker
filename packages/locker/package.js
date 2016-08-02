Package.describe({
	// [validatis:stack]
	name: 'convexset:locker',
	version: '0.1.2_2',
	summary: 'A package for providing locking functionality in Meteor Methods',
	git: 'https://github.com/convexset/meteor-locker',
	documentation: '../../README.md'
});


Package.onUse(function(api) {
	api.versionsFrom('1.3.1');

	api.use(
		[
			'ecmascript', 'ejson',
			'accounts-base',
			'ddp',
			'mongo',
			'tmeasday:check-npm-versions@0.3.1'
		],
		'server');

	api.addFiles(['locker.js'], 'server');
	api.export(['LockerFactory'], 'server');
});


Package.onTest(function(api) {
	api.use(['tinytest', 'ecmascript', 'ejson', ]);
	api.use('convexset:locker');
	api.addFiles(['tests.js', ]);
	api.addFiles([], 'server');
	api.addFiles([], 'client');
});