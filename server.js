var http = require('http'),
	sys = require('sys'),
	redis = require('redis'),
	couch_client = require('couch-client'),
	couch = couch_client('/rayframe');
	log = require('./lib/logger'),
	fs = require('fs'),
	path = require('path'),
	express = require('express'),
	isAdmin = 1, // TODO: Authentication with login form, maybe user level permissions
	adminFiles = '<script src="/static/admin/mootools.js"></script><script src="/static/admin/admin_functions.js"></script><link rel="stylesheet" href="/static/admin/admin.css" />';

log.log_level = 'info';
couch.request('GET', '/rayframe', function(err, result) {
	if(result.error) {
		if(result.reason == 'no_db_file') {
			couch.request('PUT', '/rayframe', function() {
				couch.save({_id:'/', template:'index.html', title:'hello', welcome_msg:'welcome!'}, function() {
				console.log('Welcome to Ray-Frame. Your home page has been automatically added to the database.');
					runServer();
				});
			});
		} else {
			log.error('Aw snap, everything is terrible: '+err);
		}
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
		couch.get(req.url, function(err, content) {
			if(content) {
				serveTemplate(req.url, content, function(err, parsed) {
					if(!err) {
						res.writeHead(200, {'Content-Type': 'text/html'});
						res.end(parsed);
					} else {
						log.error('uh oh: '+err);
						res.writeHead(500, {'Content-Type': 'text/html'});
						res.end('Internal server errrrrrror');
					}
				});
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

function serveTemplate(url, obj, cb) {
	parseTemplate(url, obj, cb);
	//try {
		//var f = fs.readFileSync('compiled/'+obj.template);
		//return f;
	//} catch(e) {
		//return parseTemplate(obj);
	//}
}

var modelReplaces = /{{\S+?}}/g;

function parseTemplate(url, obj, cb) {
	try {
		var f = fs.readFileSync('templates/'+obj.template).toString();
	} catch(e) {
		cb('Template not found for `'+sys.inspect(obj)+'`: '+e);
		return;
	}

	function replace(f) {
		var matches = f.match(modelReplaces);
		if(matches) {
			getData(url, matches[0], obj, function(err, val) {
				f = f.replace(matches[0], val);
				replace(f, matches);
			});
		} else {
			f = f.replace('</body>', adminFiles+'</body>');
			fs.writeFileSync('compiled/'+obj.template, f);
			cb(null, f);
		}
	}
	replace(f);
}

function getData(url, str, obj, cb) {
	var instructions = getInstructions(str);
		val = obj[instructions.field] || '';
	// If this is an included file we need to start the parse chain all over again
	if(instructions.include) {
		var lookup = url+'/'+instructions.field;
		couch.get(lookup, function(err, firstres) {
			if(err) {
				// This thing is not yet in the database. Let's put it there!
				var new_obj = {_id:lookup, template: instructions.field};
				// TODO: Here we create the db entry even if the template file does not exist.
				// We should check for it and error up there if it doesn't exist
				couch.save(new_obj, function(err, added) {
					serveTemplate(lookup, new_obj, cb);
				});
			} else {
				// This thing is in the database, return it parsed
				serveTemplate(lookup, firstres, cb);
			}
		});
	} else if(isAdmin && !instructions.noEdit) {
		cb(null, '<span class="edit_me" id="'+url+':'+instructions.raw+'">'+val+'</span>');
	} else {
		cb(null, val);
	}
}

function getInstructions(plip) {
	var raw = plip.substring(2, plip.length-2),
		fields = raw.split(':');
	return {
		field: fields[0],
		raw: raw,
		noEdit: fields.indexOf('noEdit') > -1 ? true : false,
		//TODO: better way to identify {{template.html}} import
		include: fields[0].indexOf('.html') > 0 ? true : false
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

	couch.get(parts[0], function(err, doc) {
		doc[parts[1]] = req.body.value;
		couch.save(doc, function(err, dbres) {
			if(err) {
				res.writeHead(200, {'Content-Type': 'text/json'});
				res.send({status:'failure', message:err});
			} else {
				res.send({status:'success', new_value:req.body.value});
			}
		});
	});
}
