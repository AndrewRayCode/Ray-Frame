// Run me with
// > node runme.js
var server = require('./core/server');

server.createServer({
    // Configuration options for your VERY OWN SERVER!
    theme: 'ray-frame',
    server_port: 8080,
    hard_reset: true
});
