var http = require('http'),
	sys = require('sys'),
	redis = require('redis'); 
	log = require('./lib/logger'),
	fs = require('fs'),
	client = redis.createClient().on('error', function(err) {
		log.error('poop went kablamo: '+err);
	}),
	isAdmin = 1;

log.log_level = 'info';
client.hgetall('/', function(err, res) {
	if(res !== null) {
		client.HMSET('/', {template:'index.html', title:'hello', welcome_msg:'Welcome to this website!'}, function() {
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
				res.writeHead(200, {'Content-Type': 'text/html'});
				res.end(serveTemplate(content));
			} else if (err) {
				log.error('uh oh: '+err);
				res.writeHead(500, {'Content-Type': 'text/html'});
				res.end('Internal server errrrrrror');
			} else {
				res.writeHead(404, {'Content-Type': 'text/html'});
				res.end('UR KRAP IS MISSN');
			}
		});
	}).listen(8080, "127.0.0.1");
	console.log('Server running!');
};

function serveTemplate(obj) {
	return parseTemplate(obj);
	try {
		var f = fs.readFileSync('compiled/'+obj.template);
		return f;
	} catch(e) {
		return parseTemplate(obj);
	}
}

var modelReplaces = /{{\S+?}}/g;

function parseTemplate(obj) {
	try {
		var f = fs.readFileSync('templates/'+obj.template).toString();

		var matches = f.match(modelReplaces), s = matches.length;
		while(s--) {
			f = f.replace(matches[s], getData(matches[s], obj));
		}

		fs.writeFileSync('compiled/'+obj.template, f);
		return f;
	} catch(e) {
		log.error('Template not found for `'+obj+'`: '+e);
	}
}

function getData(str, obj) {
	var val = obj[str.substring(2, str.length-2)] || '';
	return val;
}
