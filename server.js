var http = require('http'),
	sys = require('sys'),
	redis = require('redis'),
	couch_client = require('couchdb').createClient(5984, 'localhost'),
	log = require('./lib/logger'),
	fs = require('fs'),
	path = require('path'),
	express = require('express'),
	isAdmin = 1, // TODO: Authentication with login form, maybe user level permissions
	adminFiles = '<script src="/static/admin/mootools.js"></script><script src="/static/admin/admin_functions.js"></script><link rel="stylesheet" href="/static/admin/admin.css" />';

log.log_level = 'info';
var server = express.createServer();
server.use(express.bodyDecoder());
server.error(function(err, req, res) {
	log.warn('Server error: '+err);
	res.send('what the heck');
});

// Reset the database on every startup for now
var couch = couch_client.db('rayframe');
couch.exists(function(err, exists) {
    function recreate() {
        couch.create(function(err) {
            if(err) {
                log.error(sys.inspect(err));
            } else {
                couch = couch_client.db('rayframe');
                log.info('Recreated database `rayframe`');

                // Create a view for url lookup
                couch.saveDesign('master', {
                    views: {
                        'url':{
                            map: function(doc) {
                                if(doc.url) {
                                    emit(doc.url, doc.reference);
                                }
                            }
                        }
                    }
                }, function(err) {
                    // Create our homepage object and url object for it
                    couch.bulkDocs({docs: [
                        {key:'root', template:'index.html', title:'hello'},
                        {url:'.', reference:'root', chain:[]}]},
                        function() {
                            log.info('Welcome to Ray-Frame. Your home page has been automatically added to the database.');
                            runServer();
                    });
                });
            }
        });
    }

    if(exists) {
        log.info('Existing database found, deleting for development');
        couch.remove(recreate);
    } else {
        recreate();
    }
});


// TODO: This all needs to be one entry point for simpler authentication
server.post('/update', updateField);
server.post('/addListPage', addListPage);
server.post('/removeListPage', removeListPage);
server.post('/getTemplates', getTemplates);
server.post('/getView', getView);

server.get(/.*/, function(req, res) {
	var path = req.url.split('/'),
		dbPath = sanitizeUrl(req.url);

    // Static file handling
	if(path[1] == 'static') {
		try {
			res.writeHead(200, {'Content-Type': guessContentType(req.url)});
			// TODO: readFileSync to avoid callback nonsense, but it's unavoidable, so make non-sync
			res.end(fs.readFileSync(req.url.substring(1)));
		} catch(e) {
			res.writeHead(404, {'Content-Type': 'text/html'});
			res.end('Todo: this should be some standardized 404 page' + e);
		}
	} else {
        //db.view(design, view, [query], [cb])
        couch.view('master', 'url', {key: dbPath}, function(err, result) {
            if(err) {
				log.error('Error fetching URL view: '+sys.inspect(err));
				res.writeHead(500, {'Content-Type': 'text/html'});
				res.end('Internal server errrrrrror');
            // 404 or somehow impossible more than one object per url
            } else if(result.total_rows != 1) {
                log.warn('Requested page was not found: '+sys.inspect(req.url)+' (lookup in view was `'+dbPath+'`)');
				res.writeHead(404, {'Content-Type': 'text/html'});
				res.end('The page you requested was not found on this server :(');
            } else {
                couch.getDoc(result.rows[0].value, function(err, page) {
                    serveTemplate(page, function(err, parsed) {
                        if(err) {
                            log.error('Error serving template for `'+req.url+' (CouchDB key `'+dbPath+'`)'+sys.inspect(err));
                            res.writeHead(500, {'Content-Type': 'text/html'});
                            res.end('Internal server errrrrrror');
                        }
                    });
                });

            }
        });
	}
});

function runServer() {
	server.listen(8080);
	log.info('Server running!');

}

function serveTemplate(url, obj, cb) {
	// TODO: Right now we are forcing the recreation of the template from disk. Original plan was to store those parsed files in compiled/ directory. Look into this
	parseTemplate(url, obj, cb);
	//try {
		//var f = fs.readFileSync('compiled/'+obj.template);
		//return f;
	//} catch(e) {
		//return parseTemplate(obj);
	//}
}

var modelReplaces = /\{\{\S+?\}\}/g;

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
		var lookup = 'includes'+instructions.field;
		getOrCreate(lookup, instructions.field, function(err, obj) {
			if(err) {
				cb(err);
			} else {
				serveTemplate(lookup, obj, cb);
			}
		});
	} else if(isAdmin) {
		if(instructions.list) {
			cb(null, '<span class="edit_list" id="'+url+':'+instructions.raw+'">'+val+'</span>');
		} else if(!instructions.noEdit) {
			cb(null, '<span class="edit_me" id="'+url+':'+instructions.raw+'">'+val+'</span>');
		} else {
			cb(null, val);
		}
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
		include: fields[0].indexOf('.html') > 0 ? true : false,
		list: fields[1] == 'list' ? true : false
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

function addListPage(req, res) {

}

function removeListPage(req, res) {

}

function getView(req, res) {
	getOrCreate(sanitizeUrl(req.url)+req.body.view, req.body.view, function(err, obj) {
		if(err) {
			res.send({status:'failure', message:err});
		} else {
			serveTemplate(sanitizeUrl(req.url), obj, function(err, parsed) {
				if(err) {
					res.send({status:'failure', message:err});
				} else {
					res.send({status:'success', parsed:parsed});
				}
			});
		}
	});
}

function getTemplates(req, res) {
	fs.readdir('templates/', function(err, files) {
		if(err) {
			res.send({status:'failure', message:err.message});
		} else {
			var clean = [];
			// Filter out VIM swap files for example
			for(var x=0; x<files.length; x++) {
				if(/\.html$/.test(files[x])) {
					clean.push(files[x]);
				}
			}
			res.send({status:'success', templates:clean});
		}
	});
}

function updateField(req, res) {
	var parts = req.body.field.split(':');

	couch.getDoc(parts[0], function(err, doc) {
		doc[parts[1]] = req.body.value;
		couch.saveDoc(doc._id, doc, function(err, dbres) {
			if(err) {
				res.send({status:'failure', message:err});
			} else {
				res.send({status:'success', new_value:req.body.value});
			}
		});
	});
}

// Replace all `/` in the url with `.`, never any trailing or leading `.`s except for root page
function sanitizeUrl(str) {
    return str.replace(/\//g, '.').replace(/(.+)\.$/, '$1').replace(/^\.(.+)/, '$1');

}

function getOrCreate(path, template, cb) {
	couch.getDoc(path, function(err, firstres) {
		if(err) {
			// This thing is not yet in the database. Let's put it there!
			var new_obj = {template: template};
			// TODO: Here we create the db entry even if the template file does not exist.
			// We should check for it and error up there if it doesn't exist
			couch.saveDoc(path, new_obj, function(err, added) {
				cb(err, new_obj);
			});
		} else {
			cb(null, firstres);
		}
	});
}
