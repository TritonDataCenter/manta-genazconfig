/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * lib/schema.js: JSON Schema v3 schemas for various elements of this program
 */

/*
 * Configuration file schema
 */
var mgSchemaConfig = {
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
var mgSchemaConfigRegion = {
    'type': 'object',
    'additionalProperties': false,
    'properties': {
	'nshards': {
	    'type': 'integer',
	    'required': true,
	    'minimum': 1,
	    'maximum': 128
	},
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

/*
 * Schema for devices from Device42.  This only includes fields that we use.
 */
var mgSchemaD42Device = {
    'type': 'object',
    'properties': {
	'device_id': { 'type': 'integer', 'required': true },
	'serial_no': { 'type': 'string',  'required': true },
	'hw_model':  { 'type': 'string',  'required': true },
	'building':  { 'type': 'string',  'required': true },
	'rack':      { 'type': 'string',  'required': true },
	'start_at':  { 'type': 'integer', 'required': true }
    }
};

var mgSchemaD42DeviceList = {
    'type': 'array',
    'items': mgSchemaD42Device
};

/* exported interface */
exports.mgSchemaConfig = mgSchemaConfig;
exports.mgSchemaConfigRegion = mgSchemaConfigRegion;
exports.mgSchemaD42Device = mgSchemaD42Device;
exports.mgSchemaD42DeviceList = mgSchemaD42DeviceList;
