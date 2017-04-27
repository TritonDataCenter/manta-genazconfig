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

var mgSchemaTritonNetwork = {
    'type': 'object',
    'required': true,
    'properties': {
	'name':               { 'type': 'string',  'required': true },
	'nic_tag':            { 'type': 'string',  'required': true },
	'subnet':             { 'type': 'string',  'required': true },
	'gateway':            { 'type': 'string',  'required': true },
	'provision_start_ip': { 'type': 'string',  'required': true },
	'provision_end_ip':   { 'type': 'string',  'required': true },
	'vlan_id':            { 'type': 'integer', 'required': true }
    }
};

var mgSchemaConfigNetwork = {
    'type': 'object',
    'required': true,
    'properties': {
	'network': mgSchemaTritonNetwork,
	'nic_mapping': {
	    'type': 'string',
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
		    },
		    'networking': {
			'type': 'object',
			'properties': {
			    'admin':  mgSchemaConfigNetwork,
			    'manta':  mgSchemaConfigNetwork,
			    'marlin': mgSchemaConfigNetwork
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
	'device_id': { 'type': 'integer',            'required': true },
	'serial_no': { 'type': 'string',             'required': true },
	'name':      { 'type': 'string',             'required': true },

	/*
	 * We've observed cases where Device42 left out the "building" field,
	 * even for devices returned as part of a query that filtered on the
	 * building.  As a result, we don't require this to be here, and we'll
	 * ignore the fact that it's missing.
	 *
	 * Similarly, we've found some servers missing a "rack" and "start_at".
	 * We'll ignore these completely.
	 */
	'building':  { 'type': 'string'                               },
	'rack':      { 'type': 'string'                               },
	'start_at':  { 'type': 'integer'                              },

	/*
	 * "uuid" and "ram" may not be available until after a server has been
	 * set up.  "hw_model" may not be present on non-server devices.
	 */
	'uuid':      { 'type': 'string'                               },
	'ram':       { 'type': [ 'number', 'null' ], 'required': true },
	'hw_model':  { 'type': [ 'string', 'null' ], 'required': true }
    }
};

var mgSchemaD42DeviceList = {
    'type': 'array',
    'items': mgSchemaD42Device
};

/*
 * Schema for servers in Triton.  This only includes fields that we use.
 */
var mgSchemaTritonServer = {
    'type': 'object',
    'properties': {
	'ram':      { 'type': 'integer', 'required': true },
	'hostname': { 'type': 'string',  'required': true },
	'headnode': { 'type': 'boolean', 'required': true },
	'reserved': { 'type': 'boolean', 'required': true },
	'uuid':     { 'type': 'string',  'required': true },
	'sysinfo': {
	    'type': 'object',
	    'required': true,
	    'properties': {
		'Product':       { 'type': 'string', 'required': true },
		'Serial Number': { 'type': 'string', 'required': true }
	    }
	}
    }
};

var mgSchemaTritonServerList = {
    'type': 'array',
    'items': mgSchemaTritonServer
};

/* exported interface */
exports.mgSchemaConfig = mgSchemaConfig;
exports.mgSchemaConfigRegion = mgSchemaConfigRegion;
exports.mgSchemaD42Device = mgSchemaD42Device;
exports.mgSchemaD42DeviceList = mgSchemaD42DeviceList;
