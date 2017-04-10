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

var mgCmds = {
    'fetch-inventory': mgCmdFetchInventory
};

var mgGlobalOptStr = 'c:(config-file)d:(data-dir)';

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
	var args, parser, option, funcs;
	var mgopts = {
	    'mgo_cmd': null,
	    'mgo_cmdfunc': null,
	    'mgo_config_file': './mgenazconfig.json',
	    'mgo_data_dir': mod_path.join('.', 'mgenazconfig_data'),
	    'mgo_config': null,
	    'mgo_config_region': null,
	    'mgo_password': null
	};

	mod_cmdutil.configure({
	    'usageMessage': 'generate Manta region description file',
	    'synopses': [
	        '[GLOBAL_OPTIONS] fetch-inventory REGION'
	    ]
	});

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

	funcs.push(function mgInventoryFetchDevices(_, subcallback) {
		var building, devices, stream;

		building = mgopts.mgo_config_region.azs[0].d42building;
		devices = [];
		stream = mod_device42.d42FetchRawDeviceDetails({
		    'url': mgopts.mgo_config.device42.url,
		    'username': mgopts.mgo_config.device42.username,
		    'password': mgopts.mgo_password,
		    'queryparams': {
		        'building': mgopts.mgo_config_region.azs[0].d42building
		    }
		});

		stream.on('data', function (obj) {
			devices.push(obj);
		});

		stream.on('error', function (err) {
			err = new VError(err, 'fetching devices');
			subcallback(err);
		});

		stream.on('end', function () {
			if (devices.length === 0) {
				subcallback(new VError(
				    'no devices found in building "%s"',
				    building));
				return;
			}

			mod_fs.writeFile(outfile, JSON.stringify(devices),
			    function (err) {
				if (err) {
					err = new VError(err,
					    'write "%s"', outfile);
				}

				subcallback(err);
			    });
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
 * Prompt the user for a password and store it into mgopts.mgo_password.
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
		iface.close();
		callback();
	});

	process.stdin.setRawMode(true);
}

main();
