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

var printf = mod_extsprintf.printf;

var mod_device42 = require('../lib/device42');
var mod_schema = require('../lib/schema');

/* Subcommands */
var mgCmds = {
    'fetch-inventory': mgCmdFetchInventory,
    'gen-manta': mgCmdGenManta
};

/* getopt option string for global options */
var mgGlobalOptStr = 'c:(config-file)d:(data-dir)';

/*
 * Defines how to determine the type of server from its hardware type.  This
 * should really be part of the configuration file.
 */
var mgHardwareToServerType = {
    'Joyent-Compute-Platform-3301': 'metadata',
    'Joyent-Storage-Platform-7001': 'storage'
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
	    'mgo_region_name': null,
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
	if (!mod_jsprim.hasKey(mgCmds, mgopts.mgo_cmd)) {
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

		err = mod_jsprim.validateJsonObject(
		    mod_schema.mgSchemaConfig, parsed);
		if (err) {
			callback(new VError(err, 'validate "%s"',
			    mgopts.mgo_config_file));
			return;
		}

		for (regionName in parsed.regions) {
			region = parsed.regions[regionName];
			err = mod_jsprim.validateJsonObject(
			    mod_schema.mgSchemaConfigRegion, region);
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
	if (!mod_jsprim.hasKey(mgopts.mgo_config.regions, regionName)) {
		callback(new VError('unknown region: "%s"', regionName));
		return;
	}

	mgopts.mgo_region_name = regionName;
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
	if (!mod_jsprim.hasKey(mgopts.mgo_config.regions, regionName)) {
		callback(new VError('unknown region: "%s"', regionName));
		return;
	}

	mgopts.mgo_region_name = regionName;
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

			err = mod_jsprim.validateJsonObject(
			    mod_schema.mgSchemaD42DeviceList, parsed);
			if (err) {
				subcallback(new VError(err,
				    'validate "%s"', filepath));
				return;
			}

			subcallback(null, {
			    'az': az.name,
			    'devices': parsed.map(function (p) {
				return (new mod_device42.D42Device(p));
			    })
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
	var rv, counters, comparators, outfile;

	/*
	 * XXX compare to spc-manta-genazconfig
	 */
	rv = {};
	rv.nshards = mgopts.mgo_config_region.nshards;
	rv.servers = [];

	counters = {
	    'nUnknownHw': 0,
	    'nUnknownRack': 0,
	    'nMetadata': 0,
	    'nStorage': 0
	};

	mgopts.mgo_config_region.azs.forEach(function (az) {
		var azrackname, racks, azdevices;
		var nmetadata, nstorage;

		/*
		 * Build up a set of allowed rack identifiers to quickly rule
		 * out servers that aren't in racks assigned to Manta.  The
		 * values in "racks" describe the count of servers of each type
		 * that we found in each rack.
		 */
		racks = {};
		az.d42racks.forEach(function (r) {
			racks[r] = {
			    'nrMetadata': 0,
			    'nrStorage': 0
			};
		});

		nmetadata = 0;
		nstorage = 0;

		azdevices = mgopts.mgo_devices_by_az[az.name];
		mod_assertplus.object(azdevices);

		azdevices.forEach(function (device) {
			var rack, devtype;

			/*
			 * We got this list by querying Device 42 for devices in
			 * this building.  We should validate this earlier, but
			 * it would be strange if we got a device in a different
			 * building.
			 */
			mod_assertplus.equal(
			    device.d42d_building, az.d42building);
			if (!mod_jsprim.hasKey(racks, device.d42d_rack)) {
				counters['nUnknownRack']++;
				return;
			}

			if (!mod_jsprim.hasKey(mgHardwareToServerType,
			    device.d42d_hardware)) {
				counters['nUnknownHw']++;
				return;
			}

			rack = racks[device.d42d_rack];
			devtype = mgHardwareToServerType[device.d42d_hardware];
			if (devtype == 'storage') {
				nstorage++;
				counters['nStorage']++;
				rack['nrStorage']++;
			} else {
				mod_assertplus.equal(devtype, 'metadata');
				nmetadata++;
				counters['nMetadata']++;
				rack['nrMetadata']++;
			}

			/*
			 * XXX uuid should be the real uuid, but they're not in
			 * Device42 yet.
			 * XXX would like to include real memory number.
			 * XXX add cross-check: no serials used more than once
			 */
			azrackname = az.name + '_' + device.d42d_rack;
			rv.servers.push({
			    'type': devtype,
			    'uuid': device.d42d_serial,
			    'az': az.name,
			    'rack': azrackname,
			    'memory': 64
			});
		});

		/*
		 * Print out a short report of the counts of servers for each
		 * rack in this AZ.
		 */
		printf('AZ %s (%d racks):\n\n', az.name, az.d42racks.length);
		printf('    %-10s  %9s  %9s\n',
		    'RACK', 'NMETADATA', 'NSTORAGE');
		az.d42racks.forEach(function (rackname) {
			printf('    %-10s  %9s  %9s\n', rackname,
			    racks[rackname].nrMetadata,
			    racks[rackname].nrStorage);
		});
		printf('    %-10s  %9s  %9s\n\n', 'TOTAL', nmetadata, nstorage);
	});

	printf('%-14s  %9d  %9d\n\n', 'ALL AZS', counters['nMetadata'],
	    counters['nStorage']);
	printf('%-38s  %5d\n', 'total Manta servers',
	    counters['nStorage'] + counters['nMetadata']);
	printf('%-38s  %5d\n', 'ignored: servers in non-Manta racks',
	    counters['nUnknownRack']);
	printf('%-38s  %5d\n', 'ignored: servers on non-Manta hardware',
	    counters['nUnknownHw']);

	/*
	 * Sort the output for human-readability and for determinism (which
	 * makes testing easier).
	 */
	comparators = [ 'az', 'rack', 'type', 'uuid' ];
	rv.servers.sort(function (s1, s2) {
		var i, sort;

		for (i = 0; i < comparators.length; i++) {
			sort = s1[comparators[i]].localeCompare(
			    s2[comparators[i]]);
			if (sort !== 0) {
				return (sort);
			}
		}

		return (0);
	});

	outfile = mgopts.mgo_region_name + '.json';
	mod_fs.writeFile(outfile, JSON.stringify(rv), {
	    'flag': 'wx'
	}, function onOutputWriteDone(err) {
		if (err) {
			if (err.code == 'EEXIST') {
				err = new VError('file already exists');
			}

			callback(new VError(err, 'write "%s"', outfile));
			return;
		}

		console.log('wrote %s', outfile);
		callback();
	});
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
