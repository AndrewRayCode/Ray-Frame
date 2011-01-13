var http = require('http'),
	sys = require('sys'),
	redis = require('redis'); 
	log = require('./lib/logger'); 
	client = redis.createClient().on('error', function(err) {
		log.error('poop went kablamo: '+err);
	});

client.get('/', function(err, res) {
	if(res === null) {
		client.set('/', {title:'hello'}, function() {
			console.log('Welcome to Ray-Frame. Your home page has been automatically added to the database.');
		});
	} else if(err) {
		log.error('Aw snap, everything is terrible: '+err);
	} else {
		runServer();
	}
});

function runServer() {
	http.createServer(function (req, res) {
		var path = req.url.split('/');

		client.get(req.url, function(err, content) {
			if(content) {
				res.writeHead(200, {'Content-Type': 'text/plain'});
				res.end('Hello World\n');
			} else {
				res.writeHead(404, {'Content-Type': 'text/plain'});
				res.end('UR KRAP IS MISSN');
			}
		});
	}).listen(8080, "127.0.0.1");

	console.log('Server running!');
};
