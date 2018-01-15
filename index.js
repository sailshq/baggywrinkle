const _ = require('@sailshq/lodash');
const rttc = require('rttc');
const packageForHttpEvent = require('./lib/http-event');
const packageForGenericEvent = require('./lib/generic-event');

module.exports = function machineAsLambda(optsOrMachineDefOrMachine, options) {

  // Set up global sails mock.
  global.sails = {
    config: {
      appPath: process.cwd(),
    },
    log: {
      info: console.log,
      debug: console.log,
      warn: console.log,
      error: console.log,
      verbose: process.env.sails_log__level==='verbose' || process.env.sails_log__level==='silly' ? console.log : () => {},
      silly: process.env.sails_log__level==='silly' ? console.log : () => {},
      blank: () => {}
    },
    on: () => {},
    once: () => {}
  };

  // Parse env vars into config.
  const prefix = 'sails_';

  // Cache the prefix length so we don't have to keep looking it up.
  const l = prefix.length;

  // Loop through the env vars, looking for ones with the right prefix.
  _.each(process.env, function(val, key) {
    // If this var's name has the right prefix...
    if((key.indexOf(prefix)) === 0) {

      // Replace double-underscores with dots, to work with Lodash _.set().
      var keypath = key.substring(l).replace(/__/g,'.');

      // Attempt to parse the value as JSON.
      try {
        val = rttc.parseHuman(val, 'json');
      }
      // If that doesn't work, humanize the value without providing a schema.
      catch(unusedErr) {
        val = rttc.parseHuman(val);
      }

      // Override the current value at this keypath in `conf` (which currently contains
      // the string value of the env var) with the now (possibly) humanized value.
      _.set(sails.config, keypath, val);

    }

  });

  // Default options.
  options = options || {};
  _.defaults(options, {
    eventType: 'http'
  });

  if (options.eventType === 'http') {
    return packageForHttpEvent(optsOrMachineDefOrMachine, options);
  }

  return packageForGenericEvent(optsOrMachineDefOrMachine, options);



};
