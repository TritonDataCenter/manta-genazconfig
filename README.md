<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2017, Joyent, Inc.
-->

# manta-genazconfig

This repository is part of the Joyent Manta project.  For contribution
guidelines, issues, and general documentation, visit the main
[Manta](http://github.com/joyent/manta) project page.

This tool uses data stored in a Device 42 inventory database to produce
configuration files used to deploy a multi-datacenter
[Manta](https://github.com/joyent/manta) stand-up.  This tool is based on a
previous tool called spc-manta-genazconfig, which was hardcoded for a particular
deployment.

For people internal to Joyent, the older (closed) tool is called
[spc-manta-genazconfig](https://github.com/joyent/spc-manta-genazconfig).


## Overview

The terminology is a little confusing because there are a bunch of different
stages of configuration files.

    Device42 data                       Triton (CNAPI) data
      |                                   |
      | `mgenazconfig fetch-inventory`    | `mgenazconfig fetch-triton`
      |                                   | (optional)
      + <---------------------------------+
      |
      | `mgenazconfig gen-manta-net`
      |
    configuration for server networking and required Manta
    networks in a region
      |
      | `manta-net.sh` (in each AZ)
      |
      V
    Manta-specific networking configured
      |
      | `mgenazconfig gen-manta`
      |
      v
    description of all servers in a region used for Manta,
    including each server's role
      |
      | `manta-adm genconfig --from-file`
      v
    Manta service layout files (one per AZ)
      |
      | Normal Manta deployment process, using the generated service layout
      | files for `manta-adm update` (in each AZ)
      v
    Deployed Manta

The configuration files from `mgenazconfig gen-manta` and
`mgenazconfig gen-manta-net` can be generated in parallel, but the above is the
general workflow when deploying Manta.

This tool itself has a configuration file that describes:

* how to reach the Device42 endpoint
* the list of regions (each region used for a separate Manta deployment)
* for each region, the list of availability zones (AZs)
* for each AZ, the name of the "building" in the Device42 database, the list of
  rack names in the Device42 database that should be part of this Manta
  deployment, and an optional CNAPI endpoint for the AZ
* optionally, for each AZ, a description of the intended networking
  configuration (see the
  [Additional `gen-manta-net` configuration](#additional-gen-manta-net-configuration)
  section)

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

## Synopsis

First, clone and build:

    $ git clone https://github.com/joyent/manta-genazconfig
    $ cd manta-genazconfig
    $ make

Create a mgenazconfig configuration file as shown above.

Now, fetch the inventory from Device42

    $ mgenazconfig -c /path/to/config/file fetch-inventory myregion

This downloads the inventory to a directory in the current working directory
called `mgenazconfig_data`.  You can override this with the `-d` option.

Now, generate a Manta configuration suitable for use by `manta-adm genconfig`:

    $ mgenazconfig -c /path/to/config/file gen-manta myregion

This will produce an output file in the current directory.

To generate Manta networking configuration suitable for use by `manta-net.sh`,
use the following:

    $ mgenazconfig -c /path/to/config/file gen-manta-net myregion.

This will produce an output file per AZ in the region.

Once Triton has been set up, you can run additional cross-checks with data from
CNAPI.  First, fetch the CNAPI inventory:

    $ mgenazconfig -c /path/to/config/file fetch-triton myregion

Like `fetch-inventory`, this downloads data to `mgenazconfig_data`.

Now, regenerate the configuration with cross-checks:

    $ mgenazconfig -c /path/to/config/file gen-manta myregion


## Additional `gen-manta-net` configuration

This piece of configuration is optional to allow `gen-manta` to be used prior to
networking information being known. To make use of the `gen-manta-net`
subcommand the following configuration additions must be made.

* In the list of AZs for a region, a "networking" object must be added that
  contains NAPI network and NIC mapping information for the "admin", "manta",
  and "mantanat" network. For example:

      ...
      }, {
      "name": "east1c",
          ...
          "networking": {
              "admin": {
                  "network": {
                      "name": "admin",
                      "nic_tag": "admin",
                      "subnet": "10.99.99.0/24",
                      "gateway": "10.99.99.1",
                      "provision_start_ip": "10.99.99.38",
                      "provision_end_ip": "10.99.99.253",
                      "vlan_id": 0
                  },
                  "nic_mapping": "aggr1"
              },
              "manta": {
                  "network": {
                  ...
      ...

The "nic_mapping" value is assumed to be an aggregation name unless the
special value of `<mac>` is used. When `<mac>` is used, the resulting
configuration file will contain placeholder values (`$server_uuid-MAC"`) that
need to be replaced with the appropriate MAC address for that server's "manta"
and "mantanat" network.

The per-network "nic_mapping" value is also assumed to be the same value across
all servers in the AZ. That is, if you require a subset of storage servers to
have a different aggregation tagged for "manta" usage, the resulting
configuration file must be edited to reflect this.


## Design notes

This process should ideally work even before Triton is set up in the target
datacenter so that the results can be verified in parallel with Triton setup.
In practice, we need server uuids to actually generate the configuration, and
those aren't available until Triton is set up.  The tool currently uses serial
numbers instead when this happens, warning the user that the file isn't directly
useful for deployment, but can still be used to verify the overall plan.

To aid in testing changes, this process should be deterministic, producing the
same output when the set of servers hasn't changed.

This tool should support an iterative process.  It should be possible to fetch
an updated inventory from Device42 or Triton and compare the resulting Manta
configuration from a previous one.  Right now this isn't built in, but the tool
does save previous snapshots of the state.  In the future, it could support
options for specifying which snapshot you want.  In the meantime, it's possible
to diff the results by hand.

This tool supports a number of cross-checks to make sure that servers are not
accidentally assigned the wrong role.  The role is determined using the hardware
class.  Then we verify:

- that the hostname matches what we expect based on the hardware class (which
  defines the prefix) and serial number (which defines the suffix)
- that metadata servers all have the same amount of DRAM
- that storage servers all have the same amount of DRAM

The previous tool additionally verified rack positions, but the expected rack
positions came from Device 42 to begin with, so that doesn't seem useful any
more.

The previous tool also used to verify BMC MAC address OUIs of metadata and
storage nodes.  We could extend this tool to do that if this is useful.

This tool also verifies:

- that Triton and Device 42 agree on each server's serial number, hostname,
  and uuid
- that we have not selected a headnode for use by Manta
- that all servers selected for use by Manta are marked reserved in Triton


## Implementation notes

For the list of information that this tool needs to generate for use by
`manta-adm genconfig --from-file`, see the [manta-adm manual
page](https://github.com/joyent/sdc-manta/blob/master/docs/man/man1/manta-adm.md#genconfig-subcommand).

For information on the networking configuration file used by `manta-net.sh`, see
the [operator guide]
(https://github.com/joyent/manta/blob/master/docs/operator-guide/index.md#networking-configuration).

For information about the Device 42 API, see [the Device42 API
reference](http://api.device42.com/).
