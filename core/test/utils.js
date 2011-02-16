var log = require('../lib/logger'),
    http = require('http'),
    server = require('../server');

exports.requestURL = function(assert, thing, hitMe, cb) {
    var rayframe;
    function run() {
        var client = http.createClient(thing.server_port, 'localhost');

        log.error(hitMe.method || 'GET');
        var request = client.request(hitMe.method || 'GET', hitMe.url);
        request.on('response', function(response) {
            log.warn('hahahahahha');
            var chunks = [], length = 0;

            request.connection.on('error', function(err) {
                assert.done();
            });
            response.on('data', function(chunk) {
                log.warn('hahahahahha');
                chunks.push(chunk);
                length += chunk.length;
            });
            function done() {
                log.warn('tititititititit');
                request.connection.end();

                var buff = new Buffer(length),
                    offset = 0;
                for(c in chunks){
                    chunks[c].copy(buff, offset, 0);
                    offset += chunks[c].length;
                }

                cb(rayframe, buff.toString());
            }
            response.on('end', done);
            response.connection.on('close', done);
        });
        request.connection.on('error', function(err) {
            log.error('Error on request to server: ',err);
            assert.done();
        });
        request.end('test?' || req.body);
    }

    // This is a config object
    if(!thing.createServer) {
        thing.db_name = thing.db_name || 'rayframe-test'; 
        thing.server_port = thing.server_port || 8081;
        thing.hard_reset = true;
        rayframe = server.createServer(thing, run);
    // We are reusing a server instance
    } else {
        rayframe = thing;
        run();
    }
};
