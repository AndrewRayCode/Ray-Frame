var server = require('./core/server');

server.createServer({
    theme: 'ray-frame',
    server_port: 8080,
    hard_restart: true
});
