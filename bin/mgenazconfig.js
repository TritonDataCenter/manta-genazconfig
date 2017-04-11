#!/usr/bin/env node

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * mgenazconfig.js: generate Manta region description for laying out Manta
 * services.
 */

var mod_assertplus = require('assert-plus');
var mod_cmdutil = require('cmdutil');
var mod_extsprintf = require('extsprintf');
var mod_fs = require('fs');
var mod_getopt = require('posix-getopt');
var mod_jsprim = require('jsprim');
var mod_mkdirp = require('mkdirp');
var mod_path = require('path');
var mod_readline = require('readline');
var mod_stream = require('stream');
var mod_vasync = require('vasync');
var VError = require('verror');

var mod_device42 = require('../lib/device42');

/* Subcommands */
var mgCmds = {
    'fetch-inventory': mgCmdFetchInventory,
    'gen-manta': mgCmdGenManta
};

/* getopt option string for global options */
var mgGlobalOptStr = 'c:(config-file)d:(data-dir)';

/*
 * Configuration file schema
 */
var mgConfigSchema = {
    'type': 'object',
    'additionalProperties': false,
    'properties': {
	'device42': {
	    'type': 'object',
	    'required': true,
	    'additionalProperties': 'false',
	    'properties': {
		'url': {
		    'type': 'string',
		    'required': true,
		    'minLength': 1
		},
		'username': {
		    'type': 'string',
		    'required': true,
		    'minLength': 1
		}
	    }
	},

	'regions': {
	    'type': 'object',
	    'required': true
	}
    }
};

/*
 * If JSON schema v3 supports specifying schemas for values inside an object
 * whose properties themselves are not known ahead of time, the author cannot
 * find it.  Instead, we explicitly check each of the region objects with this
 * schema.
 */
var mgConfigSchemaRegion = {
    'type': 'object',
    'additionalProperties': false,
    'properties': {
	'azs': {
	    'type': 'array',
	    'required': true,
	    'minItems': 1,
	    'maxItems': 3,
	    'items': {
		'type': 'object',
		'additionalProperties': false,
		'properties': {
		    'name': {
		        'type': 'string',
			'required': true,
			'minLength': 1
		    },
		    'd42building': {
		        'type': 'string',
			'required': true,
			'minLength': 1
		    },
		    'cnapi': {
		        'type': 'string',
			'minLength': 1
		    },
		    'd42racks': {
		        'type': 'array',
			'required': true,
			'minItems': 1,
			'items': {
			    'type': 'string',
			    'minLength': 1
			}
		    }
		}
	    }
	}
    }
};

function main()
{
	var mgopts, args, parser, option, funcs;

	/*
	 * This object is passed around this program to keep track of
	 * command-line options and runtime state.
	 */
	mgopts = {
	    'mgo_cmd': null,
	    'mgo_cmdfunc': null,
	    'mgo_config_file': './mgenazconfig.json',
	    'mgo_data_dir': mod_path.join('.', 'mgenazconfig_data'),
	    'mgo_config': null,
	    'mgo_config_region': null,
	    'mgo_password': null,
	    'mgo_devices_by_az': null
	};

	mod_cmdutil.configure({
	    'usageMessage': 'generate Manta region description file',
	    'synopses': [
	        '[GLOBAL_OPTIONS] fetch-inventory REGION'
	    ]
	});

	/*
	 * Parse global options.
	 */
	parser = new mod_getopt.BasicParser(mgGlobalOptStr, process.argv);
	while ((option = parser.getopt()) !== undefined) {
		switch (option.option) {
		case 'c':
			mgopts.mgo_config_file = option.optarg;
			break;

		case 'd':
			mgopts.mgo_data_dir =
			    mod_path.join(option.optarg, 'mgenazconfig_data');
			break;

		default:
			mod_cmdutil.usage();
			break;
		}
	}

	/*
	 * Identify and validate the subcommand.
	 */
	args = process.argv.slice(parser.optind());
	if (args.length === 0) {
		mod_cmdutil.usage('expected subcommand');
	}
	mgopts.mgo_cmd = args.shift();
	mgopts.mgo_cmdargs = args;
	if (!mgCmds.hasOwnProperty(mgopts.mgo_cmd)) {
		mod_cmdutil.usage('unsupported subcommand: "%s"',
		    mgopts.mgo_cmd);
	}

	mgopts.mgo_cmdfunc = mgCmds[mgopts.mgo_cmd];

	/*
	 * Read the configuration file, then invoke the subcommand function.
	 */
	funcs = [];
	funcs.push(mgConfigRead);
	funcs.push(mgopts.mgo_cmdfunc);

	mod_vasync.pipeline({
	    'arg': mgopts,
	    'funcs': funcs
	}, function (err) {
		if (err) {
			mod_cmdutil.fail(err);
		}
	});
}

/*
 * Read the configuration file, parse it as JSON, and then validate it using a
 * JSON schema.
 */
function mgConfigRead(mgopts, callback)
{
	mod_assertplus.string(mgopts.mgo_config_file);
	mod_fs.readFile(mgopts.mgo_config_file,
	    function onConfigRead(err, contents) {
		var parsed, regionName, region;

		if (err) {
			callback(new VError(err, 'read "%s"',
			    mgopts.mgo_config_file));
			return;
		}

		try {
			parsed = JSON.parse(contents);
		} catch (ex) {
			callback(new VError(ex, 'parse "%s"',
			    mgopts.mgo_config_file));
			return;
		}

		err = mod_jsprim.validateJsonObject(mgConfigSchema, parsed);
		if (err) {
			callback(new VError(err, 'validate "%s"',
			    mgopts.mgo_config_file));
			return;
		}

		for (regionName in parsed.regions) {
			region = parsed.regions[regionName];
			err = mod_jsprim.validateJsonObject(
			    mgConfigSchemaRegion, region);
			if (err) {
				callback(new VError(err,
				    'validate "%s": region "%s"',
				    mgopts.mgo_config_file, regionName));
				return;
			}
		}

		mgopts.mgo_config = parsed;
		callback();
	    });
}

/*
 * "fetch-inventory" command implementation.
 */
function mgCmdFetchInventory(mgopts, callback)
{
	var regionName, funcs, tag, invroot;
	var outfile;

	if (mgopts.mgo_cmdargs.length === 0) {
		mod_cmdutil.usage('expected region name');
	}

	if (mgopts.mgo_cmdargs.length > 1) {
		mod_cmdutil.usage('extra arguments');
	}

	regionName = mgopts.mgo_cmdargs[0];
	if (!mgopts.mgo_config.regions.hasOwnProperty(regionName)) {
		callback(new VError('unknown region: "%s"', regionName));
		return;
	}

	mgopts.mgo_config_region = mgopts.mgo_config.regions[regionName];

	funcs = [];
	tag = new Date().toISOString().slice(
	    0, '2017-01-01T00:00:00'.length) + '.' + process.pid;
	invroot = mod_path.join(mgopts.mgo_data_dir,
	    'inventory', regionName, tag);
	outfile = mod_path.join(invroot, 'devices.json');

	funcs.push(function mgInventoryDataDir(_, subcallback) {
		mod_mkdirp(invroot, function (err) {
			if (err) {
				err = new VError(err, 'mkdirp "%s"', invroot);
			}

			subcallback(err);
		});
	});

	funcs.push(mgPromptPassword);

	mgopts.mgo_config_region.azs.forEach(function (az) {
		funcs.push(function mgInventoryFetchOne(_, subcallback) {
			outfile = mod_path.join(invroot,
			    'devices-' + az.d42building + '.json');
			mgInventoryFetchDevices({
			    'mgopts': mgopts,
			    'outfile': outfile,
			    'building': az.d42building
			}, subcallback);
		});
	});

	mod_vasync.pipeline({
	    'arg': mgopts,
	    'funcs': funcs
	}, function (err) {
		callback(err);
	});
}

/*
 * Prompt the user for a password and store it into mgopts.mgo_password.  We
 * prompt the user once in subcommands that need it, then store it for use by
 * multiple requests.  We never store this on disk.
 *
 * XXX This implementation is awful, and likely works by accident.  There's no
 * way to turn off echo on the readline interface, so we give it a dummy output
 * stream and print our question separately.  For not-yet-understood reasons, we
 * also need to set the terminal to raw mode while this is going on.
 */
function mgPromptPassword(mgopts, callback)
{
	var iface, label;

	if (!process.stdin.isTTY) {
		setImmediate(callback, new VError('cannot prompt without tty'));
		return;
	}

	label = 'password for ' + mgopts.mgo_config.device42.username + '@' +
	    mgopts.mgo_config.device42.url + ': ';
	process.stderr.write(label);

	iface = mod_readline.createInterface({
	    'input': process.stdin,
	    'output': new mod_stream.PassThrough()
	});

	iface.question(label, function (answer) {
		process.stdin.setRawMode(false);
		mgopts.mgo_password = answer;
		process.stderr.write('\n');
		iface.close();
		callback();
	});

	process.stdin.setRawMode(true);
}

function mgInventoryFetchDevices(args, callback)
{
	var mgopts, building, outfile, devices, stream;

	mod_assertplus.object(args, 'args');
	mod_assertplus.object(args.mgopts, 'args.mgopts');
	mod_assertplus.string(args.outfile, 'args.outfile');
	mod_assertplus.string(args.building, 'args.building');

	mgopts = args.mgopts;
	building = args.building;
	outfile = args.outfile;
	devices = [];

	log_start('fetching device42 devices for building %s', building);
	stream = mod_device42.d42FetchRawDeviceDetails({
	    'url': mgopts.mgo_config.device42.url,
	    'username': mgopts.mgo_config.device42.username,
	    'password': mgopts.mgo_password,
	    'queryparams': {
	        'building': building
	    }
	});

	stream.on('data', function (obj) {
		devices.push(obj);
	});

	stream.on('error', function (err) {
		err = new VError(err, 'fetching devices');
		callback(err);
	});

	stream.on('end', function () {
		if (devices.length === 0) {
			callback(new VError(
			    'no devices found in building "%s"',
			    building));
			return;
		}

		mod_fs.writeFile(outfile, JSON.stringify(devices),
		    function (err) {
			if (err) {
				err = new VError(err,
				    'write "%s"', outfile);
			} else {
				log_done();
			}

			callback(err);
		    });
	});
}

/*
 * "gen-manta" command implementation
 */
function mgCmdGenManta(mgopts, callback)
{
	var regionName, dir;

	if (mgopts.mgo_cmdargs.length === 0) {
		mod_cmdutil.usage('expected region name');
	}

	if (mgopts.mgo_cmdargs.length > 1) {
		mod_cmdutil.usage('extra arguments');
	}

	regionName = mgopts.mgo_cmdargs[0];
	if (!mgopts.mgo_config.regions.hasOwnProperty(regionName)) {
		callback(new VError('unknown region: "%s"', regionName));
		return;
	}

	mgopts.mgo_config_region = mgopts.mgo_config.regions[regionName];

	dir = mod_path.join(mgopts.mgo_data_dir, 'inventory', regionName);
	mod_fs.readdir(dir, function (err, entries) {
		if (err) {
			callback(new VError(err, 'list "%s"', dir));
			return;
		}

		/*
		 * The directory entries should be ISO timestamps suffixed with
		 * pids.  If we sort them, we should have them in increasing
		 * order, making it easy to pick the latest.
		 */
		entries = entries.sort().reverse().map(function (e) {
			return (mod_path.join(dir, e));
		});

		mgFindLatestComplete({
		    'mgopts': mgopts,
		    'paths': entries
		}, function (finderr) {
			if (finderr) {
				callback(finderr);
				return;
			}

			mgGenManta(mgopts, callback);
		});
	});
}

function mgFindLatestComplete(args, callback)
{
	var mgopts, paths, path;

	mod_assertplus.object(args, 'args');
	mod_assertplus.object(args.mgopts, 'args.mgopts');
	mod_assertplus.object(args.paths, 'args.paths');

	mgopts = args.mgopts;
	paths = args.paths;
	path = paths[0];

	mod_vasync.forEachParallel({
	    'inputs': mgopts.mgo_config_region.azs,
	    'func': function mgLoadOne(az, subcallback) {
		var filepath;

		filepath = mod_path.join(path,
		    'devices-' + az.d42building + '.json');
		mod_fs.readFile(filepath, function (err, contents) {
			var parsed;

			if (err) {
				subcallback(new VError(err, 'read "%s"',
				    filepath));
				return;
			}

			try {
				parsed = JSON.parse(contents);
			} catch (ex) {
				subcallback(new VError(ex, 'parse "%s"',
				    filepath));
				return;
			}

			/* XXX schema verify */
			/* XXX first-class objects */
			subcallback(null, {
			    'az': az.name,
			    'devices': parsed
			});
		});
	    }
	}, function (err, results) {
		if (err) {
			/*
			 * XXX Consider whether we want this to invoke this
			 * function again with one fewer path?  That was the
			 * original idea, but it's not clear we want to walk
			 * backwards -- the user might not realize it and we
			 * might produce stale output.
			 */
			callback(err);
			return;
		}

		mgopts.mgo_devices_by_az = {};
		results.successes.forEach(function (s) {
			mgopts.mgo_devices_by_az[s.az] = s.devices;
		});

		callback();
	});
}

function mgGenManta(mgopts, callback)
{
	/*
	 * XXX working here:
	 * - do actual genmanta work
	 * - compare to spc-manta-genazconfig
	 */
	setImmediate(callback, new VError('not yet implemented: mgGenManta'));
}

function log_start()
{
	var str = mod_extsprintf.sprintf.apply(null, arguments);
	process.stderr.write(new Date().toISOString() + ': ' + str + ' ... ');
}

function log_done()
{
	console.error('done.');
}

main();
