Package.describe({
	name: 'convexset:locker',
	version: '0.1.1_1',
	summary: 'A package for providing locking functionality in Meteor Methods',
	git: 'https://github.com/convexset/meteor-locker',
	documentation: '../../README.md'
});


Package.onUse(function(api) {
	api.versionsFrom('1.2.0.2');

	api.use(
		[
			'ecmascript', 'underscore', 'ejson',
			'accounts-base',
			'ddp',
			'convexset:package-utils@0.1.14',
		],
		'server');

	api.addFiles(['locker.js'], 'server');
	api.export(['LockerFactory'], 'server');
});


Package.onTest(function(api) {
	api.use(['tinytest', 'ecmascript', 'underscore', 'ejson', ]);
	api.use('convexset:locker');
	api.addFiles(['tests.js', ]);
	api.addFiles([], 'server');
	api.addFiles([], 'client');
});