var http = require('http'),
	sys = require('sys'),
	redis = require('redis'); 
	log = require('./lib/logger'),
	fs = require('fs'),
	client = redis.createClient().on('error', function(err) {
		log.error('poop went kablamo: '+err);
	});

log.log_level = 'info';
client.hgetall('/', function(err, res) {
	if(res === null) {
		client.HMSET('/', {template:'index.html', title:'hello'}, function() {
			console.log('Welcome to Ray-Frame. Your home page has been automatically added to the database.');
			runServer();
		});
	} else if(err) {
		log.error('Aw snap, everything is terrible: '+err);
	} else {
		runServer();
	}
});

function runServer() {
	http.createServer(function (req, res) {
		//var path = req.url.split('/');
		client.hgetall(req.url, function(err, content) {
			if(content) {
				res.writeHead(200, {'Content-Type': 'text/plain'});
				res.end(parseTemplate(content.template));
			} else if (err) {
				log.error('uh oh: '+err);
				res.writeHead(500, {'Content-Type': 'text/plain'});
				res.end('Internal server errrrrrror');
			} else {
				res.writeHead(404, {'Content-Type': 'text/plain'});
				res.end('UR KRAP IS MISSN');
			}
		});
	}).listen(8080, "127.0.0.1");
	console.log('Server running!');
};

function parseTemplate(file) {
	var f = fs.readFileSync('templates/'+file);
	return f;
}
