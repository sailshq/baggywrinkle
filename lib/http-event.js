const async = require('async');
const _ = require('@sailshq/lodash');
const machineAsAction = require('machine-as-action');
const statuses = require('statuses');

module.exports = function packageForHttpEvent(optsOrMachineDefOrMachine, options) {

  // MAAify the passed-in machine (or machine def), unless it's already been done.
  let actionMachine = optsOrMachineDefOrMachine.IS_MACHINE_AS_ACTION ? optsOrMachineDefOrMachine : machineAsAction(optsOrMachineDefOrMachine);

  // Wrap it in a function that expects Lambda arguments, and mocks req/res out of them.
  return function(event, context, callback) {

    // Attempt to parse the body, or else leave it as "null".
    let body = null;
    try {
      body = JSON.parse(event.body);
    }
    catch (unusedError) {
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
      let _lcHeaders = Object.keys(event.headers || {}).reduce((memo, header) => { memo[header.toLowerCase()] = event.headers[header]; return memo; }, {});

      // The respond function will be defined below; included here to please Eslint's "no-use-before-define" rule.
      let respond;

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
        awsContext: context,
        auth: _.get(event, 'requestContext.authorizer')
      };

      // Mock up the `res` that the action will use.
      const res = {
        set: (header, value) => { headers[header] = value; return res; },
        status: (_statusCode) => { statusCode = _statusCode; return res; },
        json: (output) => {
          headers['Content-Type'] = 'application/json';
          if (!options.noEnvelope) {
            output = JSON.stringify(output);
          }
          respond(output);
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
            if (!options.noEnvelope) {
              payload = JSON.stringify(payload);
            }
          }
          respond(payload);
        },
        sendStatus: (statusCode) => respond(statuses(statusCode), statusCode),
        serverError: (output) => {
          if (options.hooks && options.hooks.serverError) {
            try {
              return options.hooks.serverError(output, (output) => {
                res.status(500).json(output);
              });
            }
            catch (unused) {
              return res.status(500).json(output.stack);
            }
          }
          return res.status(500).json(output.stack);
        },
        badRequest: (/* output */) => {
          return res.sendStatus(400);
        },
        forbidden: (/* output */) => {
          return res.sendStatus(403);
        },
        notFound: (/* output */) => {
          return res.sendStatus(404);
        },
        // Allow setting context for AWS response (mainly for use in authorizers).
        context: {}
      };

      // Helper function to send a valid response for a Lambda function using the API Gateway Proxy.
      respond = (body, _statusCode, _headers) => {

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
          headers['Access-Control-Allow-Headers'] = options.cors.headers && (typeof options.cors.headers === 'string' ? options.cors.headers : options.cors.headers.join(','));
          headers['Access-Control-Allow-Credentials'] = options.cors.allowCredentials;
        }

        // If a teardown option was specified, run the teardown before sending the response.
        if (typeof options.teardown === 'function') {
          options.teardown = [options.teardown];
        }
        if (_.isArray(options.teardown) && options.teardown.length) {
          return async.series(options.teardown, () => {
            if (options.noEnvelope) {
              return callback(null, body);
            }
            callback(null, {
              statusCode: statusCode,
              headers: headers,
              body: body,
              context: res.awsContext
            });
          });
        }

        // Otherwise just send the response.
        if (options.noEnvelope) {
          return callback(null, body);
        }
        callback(null, {
          statusCode: statusCode,
          headers: headers,
          body: body,
          context: res.awsContext
        });
      };

      //  ██████╗ ██╗   ██╗███╗   ██╗     █████╗  ██████╗████████╗██╗ ██████╗ ███╗   ██╗
      //  ██╔══██╗██║   ██║████╗  ██║    ██╔══██╗██╔════╝╚══██╔══╝██║██╔═══██╗████╗  ██║
      //  ██████╔╝██║   ██║██╔██╗ ██║    ███████║██║        ██║   ██║██║   ██║██╔██╗ ██║
      //  ██╔══██╗██║   ██║██║╚██╗██║    ██╔══██║██║        ██║   ██║██║   ██║██║╚██╗██║
      //  ██║  ██║╚██████╔╝██║ ╚████║    ██║  ██║╚██████╗   ██║   ██║╚██████╔╝██║ ╚████║
      //  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝    ╚═╝  ╚═╝ ╚═════╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
      //

      // If there's a bootstrap, run that first.
      if (typeof options.bootstrap === 'function') {
        options.bootstrap = [options.bootstrap];
      }
      if (_.isArray(options.bootstrap) && options.bootstrap.length) {
        async.series(options.bootstrap, (err) => {
          if (err) {
            if (options.noEnvelope) {
              return callback(null, {
                event: event,
                error: err.stack
              });
            }
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
      if (options.noEnvelope) {
        return callback(null, {
          event: event,
          error: err.stack
        });
      }
      return callback(null,{
        statusCode: 500,
        headers: {},
        body: JSON.stringify({
          event: event,
          error: e.stack
        })
      });
    }

  };

};
