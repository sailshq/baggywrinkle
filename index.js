const machineAsAction = require('machine-as-action');
const statuses = require('statuses');

module.exports = function machineAsLambda(optsOrMachineDefOrMachine, bootstrap) {

  // MAAify the passed-in machine (or machine def), unless it's already been done.
  let actionMachine = optsOrMachineDefOrMachine.IS_MACHINE_AS_ACTION ? optsOrMachineDefOrMachine : machineAsAction(optsOrMachineDefOrMachine);

  // Wrap it in a function that expects Lambda arguments, and mocks req/res out of them.
  return function(event, context, callback) {

    // Attempt to parse the body, or else leave it as "null".
    let body = null;
    try {
      body = JSON.parse(event.body)
    }
    catch (e) {
      // no-op.
    }

    try {

      // Keep track of headers set in the machine.
      let headers = {};

      // Keep track of the status code set by the machine.
      let statusCode = 200;

      // Mock up the `req` that the action will use.
      const req = {
        param: (key) => {
          return (event.pathParameters && event.pathParameters[key]) || (body && body[key]) || (event.queryStringParameters && event.queryStringParameters[key]) || undefined;
        },
        query: event.queryStringParameters,
        method: event.httpMethod,
        path: event.path
      };

      // Mock up the `res` that the action will use.
      const res = {
        set: (header, value) => { headers[header] = value; return res; },
        status: (statusCode) => { statusCode = statusCode; return res; },
        json: (output) => {
          headers['Content-Type'] = 'application/json';
          respond(JSON.stringify(output));
        },
        send: (output) => {
          let payload = output;
          if (typeof payload !== 'number' && typeof payload !== 'boolean' && payload !== null) {
            if (typeof payload === 'string') {
              headers['Content-Type'] = 'text/html';
            }
            else {
              headers['Content-Type'] = 'application/json';
            }
            payload = JSON.stringify(payload);
          }
          respond(payload)
        },
        sendStatus: (statusCode) => respond(statuses(statusCode), statusCode),
        serverError: (output) => {
          return res.json(output.stack, 500);
        }
      }

      // Send a valid response for a Lambda function using the API Gateway Proxy.
      const respond = (body, _statusCode, _headers) => {
        if (_statusCode) { statusCode = _statusCode; }
        if (_headers) { Object.assign(headers, _headers ); }
        if (!(headers['Content-Length'])) {
          headers['Content-Length'] = body.toString().length;
        }
        callback(null, {
          statusCode: statusCode,
          headers: headers,
          body: body
        });
      }

      // If there's a bootstrap, run that first.
      if (typeof bootstrap === 'function') {
        bootstrap((err) => {
          if (err) {
            callback(null,{
              statusCode: 500,
              headers: {},
              body: JSON.stringify({
                event: event,
                error: err.stack
              })
            });
            return;
          }

          // Run the machine after a successful return from the bootstrap.
          return actionMachine(req, res);
        });
        return;
      }

      // Run the machine action with the mocked req and res.
      return actionMachine(req, res);
    }

    // Most errors should be caught by the machine runner and directed to the `error` exit
    // of the machine.  This will catch errors in machine-as-lambda itself.
    catch (e) {
      callback(null,{
        statusCode: 500,
        headers: {},
        body: JSON.stringify({
          event: event,
          error: e.stack
        })
      });
    }

  }

};
