var http = require('http'),
	sys = require('sys'),
	redis = require('redis'); 
	client = redis.createClient().on('error', function(err) {
		console.log('poop went kablamo: '+err);
	});

client.get('/', function(err, res) {
	console.log(err, res);
});

http.createServer(function (req, res) {
	var path = req.url.split('/');

	client.set('test', 'hello', redis.print);

	res.writeHead(200, {'Content-Type': 'text/plain'});
	res.end('Hello World\n');
}).listen(8080, "127.0.0.1");

console.log('Server running!');
