var log = require('../lib/logger'),
    http = require('http'),
    sys = require('sys'),
    nodeunit = require('nodeunit'),
    querystring = require('querystring'),
    server = require('../server');

exports.requestURL = function(self, assert, config_or_server, hitMe, cb) {
    function run(rayframe) {
        self.rayframe = rayframe;

        var client = http.createClient(config.server_port),
            q = querystring.stringify(hitMe.body),
            request = client.request(hitMe.method || 'GET',
                hitMe.url, hitMe.method ? {'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'content-length':q.length} : {});
        request.on('response', function(response) {
            var chunks = [], length = 0;

            request.connection.on('error', function(err) {
                log.error('Error on connection: ',err);
                assert.done();
            });
            response.on('data', function(chunk) {
                chunks.push(chunk);
                length += chunk.length;
            });
            function done() {
                request.connection.end();

                var buff = new Buffer(length),
                    offset = 0;
                for(c in chunks){
                    chunks[c].copy(buff, offset, 0);
                    offset += chunks[c].length;
                }

                buff = buff.toString();
                try {
                    cb(self.rayframe, JSON.parse(buff));
                } catch(e) {
                    cb(self.rayframe, buff);
                }
            }
            response.on('end', done);
        });
        request.connection.on('error', function(err) {
            log.error('Error on request to server: ',err);
            assert.done();
        });
        request.end(q);
    }

    var config, rayframe;
    // If we are reusing a server
    if(config_or_server.createServer) {
        rayframe = config_or_server;
        config = {};
    } else {
        config = config_or_server;
    }

    // TODO: It would be super nice if we could pull these off the sever object if we are passed a server
    // object to reuse
    config.db_name = config.db_name || 'rayframe-test'; 
    config.server_port = config.server_port || 8081;
    config.hard_reset = config.hard_reset || true;
    config.theme = config.theme || 'test_theme';

    // Make a new server if we are passed a config option, else assume one is open
    if(rayframe) {
        run(rayframe);
    } else {
       server.createServer(config, function(err, server) {
           run(server);
       });
    }
};

function testCase(suite){
    suite.setUp =  function(test){
        this.rayframe = null;
        test.done();
    };
    suite.tearDown = function(test){
        if(this.rayframe) {
            this.rayframe.express.close();
        }
        test.done();
    };
    return testCase.super_.call(this, suite);
}
sys.inherits(testCase, nodeunit.testCase);
exports.testCase = testCase;
