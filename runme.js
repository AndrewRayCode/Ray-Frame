// Run me with
// > node runme.js
var server = require('./core/server');

server.createServer({
    // Configuration options for your VERY OWN SERVER!
    theme: 'jaded',
    server_port: 8080,
    secret: 'hackme',
    hard_reset: true
});
