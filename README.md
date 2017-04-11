# manta-genazconfig

This tool uses data stored in a Device 42 inventory database to produce
configuration files used to deploy a multi-datacenter
[Manta](https://github.com/joyent/manta) stand-up.  This tool is based on a
previous tool called spc-manta-genazconfig, which was hardcoded for a particular
deployment.


## Overview

The terminology is a little confusing because there are a bunch of different
stages of configuration files.

    mgenazconfig configuration + Device42 data
      |
      | mgenazconfig
      v
    description of all servers in a region used for Manta,
    including each server's role
      |
      | manta-adm genconfig --from-file
      v
    Manta service layout files (one per AZ)
      |
      | Normal Manta deployment, using the generated service layout files for
      | "manta-adm update" (in each AZ)
      v
    Deployed Manta

This tool itself has a configuration file that describes:

* how to reach the Device42 endpoint
* the list of regions (each region used for a separate Manta deployment)
* for each region, the list of availability zones (AZs)
* for each AZ, the name of the "building" in the Device42 database and the list
  of rack names in the Device42 database that should be part of this Manta
  deployment

Here's an example configuration file for a single, eight-shard, three-AZ Manta
deployment using two racks' worth of servers per DC:

    {
        "device42": {
	    "url": "https://d42.example.com",
	    "username": "your_username"
	},
	"regions": {
	    "myregion": {
		"nshards": 8,
		"azs": [ {
		    "name": "myregion-az1",
		    "d42building": "MY_REGION_ONE",
		    "d42racks": [ "myrack01", "myrack02" ],
		    "cnapi": "10.1.0.15"
		}, {
		    "name": "myregion-az2",
		    "d42building": "MY_REGION_TWO",
		    "d42racks": [ "myrack03", "myrack04" ],
		    "cnapi": "10.2.0.15"
		}, {
		    "name": "myregion-az3",
		    "d42building": "MY_REGION_THREE",
		    "d42racks": [ "myrack05", "myrack06" ],
		    "cnapi": "10.3.0.15"
		} ]
	    }
	}
    }

`mgenazconfig` will take this file and:

- fetch the list of servers in each of the specified buildings
- determine the role for each server based on the hardware configuration of each
  server
- emit a configuration file suitable for use with `manta-adm genconfig
  --from-file` for laying out Manta services on these servers


## Synopsis

First, clone and build:

    $ git clone https://github.com/joyent/manta-genazconfig
    $ cd manta-genazconfig
    $ make

Create a mgenazconfig configuration file as shown above.

Now, fetch the inventory from Device42

    $ mgenazconfig -c /path/to/config/file fetch-inventory myregion

Now, generate a Manta configuration:

    $ mgenazconfig -c /path/to/config/file gen-manta myregion

This will produce output files in the current directory.

Once Triton has been set up, you can run additional cross-checks with data from
CNAPI.  First, fetch the CNAPI inventory:

    $ mgenazconfig -c /path/to/config/file fetch-triton myregion

Now, run cross-checks:

    $ mgenazconfig -c /path/to/config/file verify-manta \
        myregion /path/to/previous/output


## Design notes

* This process should ideally work even before Triton is set up in the target
  datacenter so that the results can be verified in parallel with Triton setup.
* To aid in testing changes, this process should be deterministic, producing the
  same output when the set of servers hasn't changed.
* This tool should support an iterative process.  It should be possible to fetch
  an updated inventory from Device42 and compare the resulting Manta
  configuration from a previous one.
* This tool should support a number of cross-checks to make sure that servers
  are not accidentally assigned the wrong role.  Using data from Device42, this
  tool can ensure that servers with the same role have the same BMC MAC address
  OUI, indicating that they're from the same manufacturer.  Using data from
  Triton after setup is complete, this tool can verify that all servers have the
  same amount of DRAM.
* Relatedly, the tool should support cross-checks for the data in Device42: that
  serial numbers match hostnames in the way we expect.
* Relatedly, the tool should cross-check the Device42 data with the Triton data,
  ensuring that servers have the expected uuids, hostnames, and serial numbers.
