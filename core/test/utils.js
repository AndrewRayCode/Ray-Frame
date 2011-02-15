var log = require('../lib/logger'),
    http = require('http'),
    server = require('../../server');

exports.requestURL = function(assert, thing, hitMe, cb) {
    var rayframe;
    function run() {
        var client = http.createClient(thing.server_port, 'localhost');

        var request = client.request(hitMe.method || 'GET', hitMe.url).on('response', function(response) {
            var chunks = [], length = 0;

            request.connection.on('error', function(err) {
                assert.done();
            });
            response.on('data', function(chunk) {
                chunks.push(chunk);
                length += chunk.length;
            });
            function done(){
                request.connection.end();

                var buff = new Buffer(length),
                    offset = 0;
                for(c in chunks){
                    chunks[c].copy(buff, offset, 0);
                    offset += chunks[c].length;
                }

                cb(rayframe, buff);
            }
            response.on('end', done);
            response.connection.on('close', done);
        });
        request.connection.on('error', function(err) {
            log.error('Error on request to server: ',err);
            assert.done();
        });
        request.end(req.body);
    }

    // This is a config object
    if(!thing.createServer) {
        thing.db_name = thing.db_name || 'rayframe-test'; 
        rayframe = server.createServer(thing, run);
    // We are reusing a server instance
    } else {
        rayframe = thing;
        run();
    }
};
