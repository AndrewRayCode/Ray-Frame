// Run me with
// > node runme.js

require('./core/server').createServer({
    // Configuration options for your VERY OWN SERVER!
    theme: 'jaded',
    server_port: 8080,
    secret: 'hackme',
    hard_reset: true,
    debug: true
});
