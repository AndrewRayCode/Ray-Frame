var log = require('../lib/logger'),
    server = require('../../server');

exports.requestURL = function(thing, url) {
    function run() {

    }
    // This is a config object
    if(!thing.createServer) {
        server.createServer(thing, run);
    }
};
