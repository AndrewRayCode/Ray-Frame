var http = require('http'),
	sys = require('sys'),
	redis = require('redis'); 
	log = require('./lib/logger'),
	fs = require('fs'),
	path = require('path'),
	express = require('express'),
	client = redis.createClient().on('error', function(err) {
		log.error('poop went kablamo: '+err);
	}),
	isAdmin = 1, // TODO: Authentication with login form, maybe user level permissions
	adminFiles = '<script src="/static/admin/mootools.js"></script><script src="/static/admin/admin_functions.js"></script><link rel="stylesheet" href="/static/admin/admin.css" />';

log.log_level = 'info';
client.hgetall('/', function(err, res) {
	if(res === null) {
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

var server = express.createServer()
server.use(express.bodyDecoder());
server.error(function(err, req, res) {
	log.warn('Server error: '+err);
	res.send('what the heck');
});

server.post('/update', updateField);

server.get(/.*/, function(req, res) {
	var path = req.url.split('/');
	if(path[1] == 'static') {
		try {
			res.writeHead(200, {'Content-Type': guessContentType(req.url)});
			res.end(fs.readFileSync(req.url.substring(1)));
		} catch(e) {
			res.writeHead(404, {'Content-Type': 'text/html'});
			res.end('Todo: this should be some standardized 404 page' + e);
		}
	} else {
		client.hgetall(req.url, function(err, content) {
			if(content) {
				content.id = req.url; // TODO: We need this for the admin markup, but this seems dumb
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
	}
});

function runServer() {
	server.listen(8080);
	console.log('Server running!');

}

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
		f = f.replace('</body>', adminFiles+'</body>');

		fs.writeFileSync('compiled/'+obj.template, f);
		return f;
	} catch(e) {
		log.error('Template not found for `'+obj.template+'`: '+e);
	}
}

function getData(str, obj) {
	var instructions = getInstructions(str);
		val = obj[instructions.field] || '';
	if(isAdmin && !instructions.noEdit) {
		return '<span class="edit_me" id="'+obj.id+':'+instructions.raw+'">'+val+'</span>';
	}
	return val;
}

function getInstructions(plip) {
	var raw = plip.substring(2, plip.length-2),
		fields = raw.split(':');
	return {
		field: fields[0],
		raw: raw,
		noEdit: fields.indexOf('noEdit') > -1 ? true : false
	};
}

function guessContentType(file) {
	var ext = path.extname(file);
	if(ext == '.css') {
		return 'text/css';
	} else if(ext == '.js') {
		return 'text/javascript';
	}
}

function updateField(req, res) {
	var parts = req.body.field.split(':');
	client.hmset(parts[0], parts[1], req.body.value, function(err, dbres) {
		if(err) {
			res.writeHead(200, {'Content-Type': 'text/json'});
			res.send({status:'failure', message:err});
		} else {
			res.send({status:'success', new_value:req.body.value});
		}
	});
}
