const util = require('util');
const async = require('async');
const machine = require('machine');
const _ = require('@sailshq/lodash');

module.exports = function packageForGenericEvent(optsOrMachineDefOrMachine, options) {

  // Build the passed-in machine (or machine def), unless it's already been done.
  let actionMachine = (optsOrMachineDefOrMachine.getDef && optsOrMachineDefOrMachine.customize) ? optsOrMachineDefOrMachine : machine.build(optsOrMachineDefOrMachine);
  console.log(actionMachine);
  // Ensure that the machine has the correct inputs (event and context).
  let machineDef = actionMachine.getDef();
  if (!machineDef.inputs.event || !machineDef.inputs.context) {
    throw new Error('Machines to be triggered by generic events must have `event` and `context` inputs.');
  }

  if (typeof machineDef.inputs.event.example !== 'object' || typeof machineDef.inputs.context.example !== 'object' || ( Object.keys(machineDef.inputs.event.example).length + Object.keys(machineDef.inputs.context.example).length ) > 0) {
    throw new Error('The `event` and `context` inputs for a generic event machine must have empty dictionary examples.');
  }

  // Wrap it in a function that expects Lambda arguments.
  return function(event, context, callback) {

    async.auto({

      bootstrap: function(cb) {
        // If there's a bootstrap, run that first.
        if (typeof options.bootstrap === 'function') {
          options.bootstrap = [options.bootstrap];
        }
        if (_.isArray(options.bootstrap) && options.bootstrap.length) {
          return async.series(options.bootstrap, cb);
        }

        return cb();

      },

      machine: ['bootstrap', function(results, cb) {

        // Call the machine, passing the event and context in as inputs.
        actionMachine({ event: event, context: context }).switch({
          success: (output) => {
            return cb(null, output);
          },
          error: (output) => {
            return cb(output);
          }
        });

      }]

    }, function done(err, results) {

      // Start an error message if there was an error running the function.
      let errMessage;
      if (err) {
        errMessage = 'An error occurred:\n' + util.inspect(err);
      }

      // If a teardown option was specified, run the teardown before sending the response.
      if (typeof options.teardown === 'function') {
        options.teardown = [options.teardown];
      }
      if (_.isArray(options.teardown) && options.teardown.length) {
        return async.series(options.teardown, (teardownErr) => {
          // If an error occurs in the teardown, handle it.
          if (teardownErr) {
            // Append the teardown error message to any existing error message from running the function.
            if (errMessage) {
              errMessage += '\n\nIn addition, an error occurred attempting to tear down the function:\n';
            }
            else {
              errMessage = 'An error occurred attempting to tear down the function:\n';
            }
            // Add the teardown error message to the message we'll return.
            errMessage += util.inspect(teardownErr);
            // Return the error.
            return callback(new Error(errMessage));
          }
          // Otherwise if no error occurred, return the machine result.
          return callback(null, results.machine);
        });
      }

      // If an error occurred running the function, return it.
      if (err) {
        return callback(new Error(errMessage));
      }

      // Otherwise return the machine results.
      return callback(null, results.machine);
    });

  };

};
