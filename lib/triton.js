/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * lib/triton.js: provides low-level interfaces for fetching data from Triton
 */

var mod_assertplus = require('assert-plus');
var mod_http = require('http');
var mod_jsprim = require('jsprim');
var mod_lomstream = require('lomstream');
var mod_net = require('net');
var mod_querystring = require('querystring');
var VError = require('verror');

/* Exported interface */
exports.tritonFetchServers = tritonFetchServers;
exports.TritonServer = TritonServer;

function tritonFetchServers(args)
{
	var ip, stream, limit;

	mod_assertplus.object(args, 'args');
	mod_assertplus.string(args.cnapiIp, 'args.cnapiIp');
	mod_assertplus.ok(mod_net.isIP(args.cnapiIp));

	limit = 50;
	ip = args.cnapiIp;
	stream = new mod_lomstream.LOMStream({
	    'limit': limit,
	    'offset': true,
	    'fetch': function tritonFetch(_1, lim, _2, resultfunc) {
		var qparams, rqargs, request;

		/*
		 * XXX commonize with d42Fetch()
		 */
		mod_assertplus.number(lim.offset);
		mod_assertplus.number(lim.limit);

		qparams = {
		    'extras': 'sysinfo',
		    'offset': lim.offset,
		    'limit': lim.limit
		};
		rqargs = {
		    'hostname': ip,
		    'path': '/servers?' + mod_querystring.stringify(qparams)
		};
		request = mod_http.get(rqargs);

		request.on('response', function (response) {
			var d, parsed;

			/*
			 * See the similar code in d42FetchStream().
			 */
			if (response.statusCode >= 300) {
				response.resume();
				resultfunc(new VError(
				    'unexpected response code "%s"',
				    response.statusCode));
				return;
			}

			d = '';
			response.on('data', function (chunk) {
				d += chunk.toString('utf8');
			});
			response.on('end', function () {
				try {
					parsed = JSON.parse(d);
				} catch (ex) {
					resultfunc(new VError(ex,
					    'failed to parse CNAPI ' +
					    'response'));
					return;
				}

				if (!Array.isArray(parsed)) {
					resultfunc(new VError(
					    'CNAPI response was not an array'));
					return;
				}

				resultfunc(null, {
				    'done': parsed.length < limit,
				    'results': parsed
				});
			});
		});
	    }
	});

	return (stream);
}

/*
 * Class used as a struct to represent servers from Triton.  See the schema in
 * lib/schema.js.
 */
function TritonServer(raw)
{
	mod_assertplus.object(raw, 'raw');
	mod_assertplus.string(raw.uuid, 'raw.uuid');
	mod_assertplus.string(raw.hostname, 'raw.hostname');
	mod_assertplus.bool(raw.headnode, 'raw.headnode');
	mod_assertplus.bool(raw.reserved, 'raw.reserved');
	mod_assertplus.number(raw.ram, 'raw.ram');
	mod_assertplus.object(raw.sysinfo, 'raw.sysinfo');
	mod_assertplus.string(raw.sysinfo['Product'], 'raw.sysinfo.Product');
	mod_assertplus.string(raw.sysinfo['Serial Number'],
	    'raw.sysinfo.Serial Number');

	this.ts_uuid = raw.uuid;
	this.ts_hostname = raw.hostname;
	this.ts_headnode = raw.headnode;
	this.ts_reserved = raw.reserved;
	this.ts_ram = raw.ram;
	this.ts_serial = raw.sysinfo['Serial Number'];
	this.ts_product = raw.sysinfo['Product'];
}
