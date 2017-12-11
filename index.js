const machineAsAction = require('machine-as-action');
const statuses = require('statuses');

module.exports = function machineAsLambda(optsOrMachineDefOrMachine, bootstrap, teardown) {

  // Allow both `(optsOrMachineDefOrMachine, options)` and `(optsOrMachineDefOrMachine, bootstrap, teardown)` signatures.
  let options = typeof bootstrap === 'object' ? bootstrap : {
    bootstrap,
    teardown
  }

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

      //  ███████╗███████╗████████╗██╗   ██╗██████╗
      //  ██╔════╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗
      //  ███████╗█████╗     ██║   ██║   ██║██████╔╝
      //  ╚════██║██╔══╝     ██║   ██║   ██║██╔═══╝
      //  ███████║███████╗   ██║   ╚██████╔╝██║
      //  ╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝
      //

      // Keep track of headers set in the machine.
      let headers = {};

      // Keep track of the status code set by the machine.
      let statusCode = 200;

      // Keep a hash of lower-cased headers for `req.get`.
      let _lcHeaders = Object.keys(event.headers || {}).reduce((memo, header) => { memo[header.toLowerCase()] = event.headers[header]; return memo }, {});

      // Mock up the `req` that the action will use.
      const req = {
        param: (key) => {
          return (event.pathParameters && event.pathParameters[key]) || (body && body[key]) || (event.queryStringParameters && event.queryStringParameters[key]) || undefined;
        },
        query: event.queryStringParameters,
        method: event.httpMethod,
        path: event.path,
        headers: event.headers,
        get: (header, defaultVal) => _lcHeaders[header.toLowerCase()] || defaultVal,
        authorizationToken: event.authorizationToken,
        awsEvent: event,
        awsContext: context
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

      // Helper function to send a valid response for a Lambda function using the API Gateway Proxy.
      const respond = (body, _statusCode, _headers) => {

        // Set the status code for the response.
        if (_statusCode) { statusCode = _statusCode; }

        // Set the headers for the response.
        if (_headers) { Object.assign(headers, _headers ); }
        // If a content-length header wasn't added manually, put one in now based on the body length.
        if (!(headers['Content-Length'])) {
          headers['Content-Length'] = body.toString().length;
        }
        // Add CORS headers if necessary.
        if (options.cors && (options.cors.origin === '*' || event.headers['Origin'] === options.cors.origin)) {
          headers['Access-Control-Allow-Origin'] = options.cors.origin;
          headers['Access-Control-Allow-Headers'] = typeof options.cors.headers === 'string' ? options.cors.headers : options.cors.headers.join(',');
          headers['Access-Control-Allow-Credentials'] = options.cors.allowCredentials;
        }

        // If a teardown option was specified, run the teardown before sending the response.
        if (options.teardown) {
          return options.teardown(() => {
            callback(null, {
              statusCode: statusCode,
              headers: headers,
              body: body
            });
          })
        }

        // Otherwise just send the response.
        callback(null, {
          statusCode: statusCode,
          headers: headers,
          body: body
        });
      }

      //  ██████╗ ██╗   ██╗███╗   ██╗     █████╗  ██████╗████████╗██╗ ██████╗ ███╗   ██╗
      //  ██╔══██╗██║   ██║████╗  ██║    ██╔══██╗██╔════╝╚══██╔══╝██║██╔═══██╗████╗  ██║
      //  ██████╔╝██║   ██║██╔██╗ ██║    ███████║██║        ██║   ██║██║   ██║██╔██╗ ██║
      //  ██╔══██╗██║   ██║██║╚██╗██║    ██╔══██║██║        ██║   ██║██║   ██║██║╚██╗██║
      //  ██║  ██║╚██████╔╝██║ ╚████║    ██║  ██║╚██████╗   ██║   ██║╚██████╔╝██║ ╚████║
      //  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝    ╚═╝  ╚═╝ ╚═════╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
      //

      // If there's a bootstrap, run that first.
      if (typeof options.bootstrap === 'function') {
        options.bootstrap((err) => {
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
